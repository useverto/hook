import { NowRequest, NowResponse } from "@vercel/node";
import Arweave from "arweave";

const arweave = Arweave.init({
  host: "arweave.net",
  port: 443,
  protocol: "https",
  timeout: 20000,
  logging: false,
});

// array of transaction IDs that are already sent to discord
let cached: string[] = [];

export default async (req: NowRequest, res: NowResponse) => {
  if (!req.query.id || typeof req.query.id !== "string")
    return res.status(403).send("Invalid request");

  const transactionID: string = req.query.id;

  if (cached.includes(transactionID))
    return res.status(403).send("Already cached");

  return await arweave.transactions
    .get(req.query.id)
    .then(async (transaction) => {
      let vertoTag = false;

      transaction["tags"].forEach((tag) => {
        let key = tag.get("name", { decode: true, string: true });
        let value = tag.get("value", { decode: true, string: true });

        if (key === "Exchange" && value === "Verto") vertoTag = true;
      });

      if (!vertoTag) return res.status(403).send("Invalid tags");
      else {
        await arweave.transactions
          .getStatus(transactionID)
          .then((status) => {
            if (status.status === 200 || status.status === 400)
              return res.status(403).send("Already completed");

            cached.push(transactionID);
            res.status(200).send("Sent webhook");
          })
          .catch((err) => {
            return res.status(500).send(err);
          });
      }
    })
    .catch((err) => {
      return res.status(500).send(err);
    });
};
