import cors from "cors";
import express, { Request, Response, Application } from "express";
import { getPubkey } from "./ns";
import { HexlinkError } from "./types";

const app: Application = express();
const port = process.env.PORT || 8000;
app.use(cors);
app.use(express.json());

app.get("/.well-known/nostr.json", async (req, res) => {
  try {
    const name = req.query.name as string;
    const pubkey = await getPubkey(name);
    if (pubkey) {
      res.status(200).json({ names: { [name]: pubkey } });
    } else {
      res.status(404).send("Not found");
    }
  } catch(err: unknown) {
    if (err instanceof HexlinkError) {
      res.status(err.code).json({message: err.message});
    } else {
      console.log("Error: ", err);
      res.status(500).json({message: "internal server error"});
    }
  }
});

app.get("/", (req: Request, res: Response) => {
  res.redirect("https://www.hexlink.io");
});

app.listen(port, () => {
  console.log(`Server is Fire at http://localhost:${port}`);
});
