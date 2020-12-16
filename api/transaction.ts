import { NowRequest, NowResponse } from "@vercel/node";
import Arweave from "arweave";
import webhook from "webhook-discord";

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
  if (
    !req.query.id ||
    typeof req.query.id !== "string" ||
    !req.query.from ||
    typeof req.query.from !== "string" ||
    !req.query.to ||
    typeof req.query.to !== "string"
  )
    return res.status(403).send("Invalid request");

  const transactionID: string = req.query.id,
    from: string = req.query.from, // from amount + pst/coin
    to: string = req.query.to, // to amount + pst/coin
    Hook = new webhook.Webhook(process.env.WEBHOOK);

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
          .then(async (status) => {
            /**
             * 202 - mining
             * 200 - mined
             * 4xx/5xx - problem with tx
             * 404 - might be propagating or might be permanent issue
             */
            if (status.status !== 202)
              return res.status(403).send("Already completed");

            cached.push(transactionID);

            const discordMessage = new webhook.MessageBuilder()
              .setColor("#b075cd")
              .setFooter(
                "Verto, a th8ta project",
                "https://github.com/useverto/design/blob/master/logo/icon.png?raw=true"
              )
              .setTitle("New Verto Swap")
              .setDescription(
                `A new Verto swap has been made (**${from}** -> **${to}**)`
              )
              .setName("Verto");

            await Hook.send(discordMessage);
            return res.status(200).send("Sent webhook");
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
