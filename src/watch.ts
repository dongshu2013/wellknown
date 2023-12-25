import SturdyWebSocket from "sturdy-websocket";
import { ethers } from "ethers";
import { AccountManager__factory, AccountManager } from "@openid3/contracts";
import { RedisService } from "./redis";
import WebSocket from "ws";
import { LogResponse } from "./types";

const SEPOLIA = {
  name: "sepolia",
  chainId: 11155111,
};

const SYS_LAST_BLOCK_KEY = "SYS:lastBlock";

const manager = process.env.CONTRACT_V0_0_8_ACCOUNT_MANAGER!;

const provider = new ethers.InfuraProvider(
  SEPOLIA.chainId,
  process.env.INFURA_API_KEY
);

const SCAN_SERVICE_URL = "https://api-sepolia.etherscan.io/api";

function genUrl(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return `${SCAN_SERVICE_URL}?${params.toString()}`;
}

async function queryAllMetadataEvents(
  query: Record<string, string>,
  redis: RedisService,
  contract: AccountManager
) {
  const resp = await fetch(genUrl(query));
  const result = await resp.json();
  if (result.status === "0" && result.message !== "No records found") {
    throw new Error(result.result);
  }
  const logs = result.result as LogResponse[];
  if (logs.length === 0) {
    return;
  }
  const events: Array<[string, string]> = logs.map((log) => {
    const parsed = contract.interface.parseLog(log);
    console.log("======> ", parsed!.args.account, " <-> ", parsed!.args.metadata)
    return [parsed!.args.account, parsed!.args.metadata];
  });
  await redis.mset(events);
  if (logs.length === Number(query.offset)) {
    const nextPage = Number(query.page) + 1;
    query.page = nextPage.toString();
    queryAllMetadataEvents(query, redis, contract);
  }
}

async function cacheMetadataEvents(
  redis: RedisService,
  toBlock: number,
  contract: AccountManager
) {
  const fromBlock = await redis.get(SYS_LAST_BLOCK_KEY);
  await queryAllMetadataEvents(
    {
      module: "logs",
      action: "getLogs",
      apikey: process.env.ETHERSCAN_API_KEY!,
      page: "1",
      offset: "1000",
      fromBlock: fromBlock ?? "0",
      toBlock: Number(toBlock).toString(),
      address: manager,
      topic0: contract.interface.getEvent("NewMetadata").topicHash,
    },
    redis,
    contract
  );
  await redis.set(SYS_LAST_BLOCK_KEY, toBlock.toString());
}

const subscribeMetadataEvent = async (contract: AccountManager) => {
  const currentBlock = await provider.getBlockNumber();
  console.log("current block is ", currentBlock);
  const redis = await RedisService.getInstance();
  console.log("adding listener...");
  contract.on(
    contract.filters.NewMetadata,
    async (account: string, metadata: string) => {
      console.log("======> ", account, " <-> ", metadata);
      await redis.set(account, metadata);
    }
  );
  console.log("restoring historical events...");
  await cacheMetadataEvents(redis, currentBlock, contract);
  console.log("all historical events restored.");
};

const createWebSocket = () => {
  const wssUrl = `wss://${SEPOLIA.name}.infura.io/ws/v3/${process.env.INFURA_API_KEY}`;
  return new SturdyWebSocket(wssUrl, {
    connectTimeout: 5000,
    maxReconnectAttempts: 5,
    reconnectBackoffFactor: 1.3,
    wsConstructor: WebSocket,
  });
}

const ws = createWebSocket();
const wssProvider = new ethers.WebSocketProvider(ws, SEPOLIA);
const contract = AccountManager__factory.connect(manager, wssProvider);

ws.onopen = async () => {
  console.log("infura ws opened");
  contract.removeAllListeners();
  await subscribeMetadataEvent(contract);
};

ws.onreopen = async () => {
  console.log("infura ws reopened");
  contract.removeAllListeners();
  await subscribeMetadataEvent(contract);
};

ws.onclose = async () => {
  console.log("infura ws closed");
  contract.removeAllListeners();
};
