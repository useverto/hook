import { NowRequest, NowResponse } from "@vercel/node";
import Arweave from "arweave";
import webhook from "webhook-discord";
import Transaction from "arweave/node/lib/transaction";
import Verto from "@verto/lib";

const arweave = Arweave.init({
    host: "arweave.net",
    port: 443,
    protocol: "https",
    timeout: 20000,
    logging: false,
  }),
  verto = new Verto(arweave);

export default async (req: NowRequest, res: NowResponse) => {
  // Verify request query parameters are valid data types
  if (!req.query.id || typeof req.query.id !== "string")
    return res.status(403).send("Invalid request");

  const transactionID: string = req.query.id,
    Hook = new webhook.Webhook(process.env.WEBHOOK),
    transaction = await arweave.transactions.get(transactionID),
    eligible: boolean = await checkEligibility(transaction);

  // Check eligibility of transaction supplied
  if (eligible) {
    // Fetch the "necessary information" for the webhook
    const necessaryInfo: {
      fromCurrency: string;
      toCurrency: string;
      fromAmount: number;
      id: string;
    } = await getNecessaryInfo(transaction);

    // Make webhook url Etherscan for an Ethereum transaction or ViewBlock for Arweave
    const transactionURL =
      necessaryInfo.id.substring(0, 2) === "0x"
        ? `https://etherscan.io/tx/${necessaryInfo.id}`
        : `https://viewblock.io/arweave/tx/${necessaryInfo.id}`;

    // Create the Discord rich-embed
    const discordMessage = new webhook.MessageBuilder()
      .setColor("#b075cd")
      .setFooter(
        "Verto, a th8ta project",
        "https://github.com/useverto/design/blob/master/logo/icon.png?raw=true"
      )
      .setTitle("New Verto Swap")
      .setDescription(
        `${necessaryInfo.fromAmount} ${necessaryInfo.fromCurrency} → ${necessaryInfo.toCurrency}`
      )
      .setURL(transactionURL)
      .setName("Verto");

    // Send the webhook to Discord
    try {
      await Hook.send(discordMessage);
      return res.status(200).send("Sent webhook");
    } catch (err) {
      return res.status(500).send(err);
    }
  } else {
    return res.status(403).send("Invalid tags");
  }
};

/**
 * Checks the eligibility of a given transaction for the webhook
 * @param transaction Arweave Transaction
 * @returns boolean
 */
async function checkEligibility(transaction: Transaction) {
  let vertoTag: boolean = false;
  let toTradingPost: boolean = false;
  let isMining: boolean = false;

  const tradingPosts = await verto.getTradingPosts();
  const txStatus = await arweave.transactions.getStatus(transaction.id);

  // Loop through tags to ensure it meets the Verto Protocol Tag Standard
  transaction["tags"].forEach((tag) => {
    let key = tag.get("name", { decode: true, string: true });
    let value = tag.get("value", { decode: true, string: true });

    if (key === "Exchange" && value === "Verto") vertoTag = true;
  });

  // Ensure transaction is being sent to a valid trading post
  for (let i = 0; i < tradingPosts.length; i++) {
    if (tradingPosts[i] === transaction.target) toTradingPost = true;
  }

  // Ensure transaction is actively being mined
  if (txStatus.status === 202) isMining = true;

  if (vertoTag && toTradingPost && isMining) return true;
  else return false;
}

/**
 * Fetches the "necessary information" for the webhook
 * @param transaction Arweave Transaction
 * @returns fromCurrency, toCurrency, fromAmount, id
 */
async function getNecessaryInfo(
  transaction: Transaction
): Promise<{
  fromCurrency: string;
  toCurrency: string;
  fromAmount: number;
  id: string;
}> {
  let fromCurrency: string = "",
    fromAmount: number,
    toCurrency: string = "",
    id: string = "";

  transaction["tags"].forEach((tag) => {
    let key = tag.get("name", { decode: true, string: true });
    let value = tag.get("value", { decode: true, string: true });

    // If quantity is zero, we're dealing with an ETH or PST input
    if (transaction.quantity === "0") {
      // Case: PST --> AR
      if (key === "Contract") {
        fromCurrency = value;
        toCurrency = "AR";
      }
      if (key === "Input") {
        let input = JSON.parse(value);
        fromAmount = input.qty;
        id = transaction.id;
      }

      // Case: ETH --> AR
      if (key === "Chain" && value === "ETH") {
        fromCurrency = "ETH";
      }
      if (key === "Hash") {
        id = value;
      }
      if (key === "Value") {
        fromAmount = parseFloat(value);
      }

      // Case: ETH --> PST
      if (key === "Token") {
        toCurrency = value;
      }
    } else {
      // Case: AR --> ETH
      if (key === "Chain" && value === "ETH") {
        fromCurrency = "AR";
        toCurrency = "ETH";
        fromAmount = parseFloat(arweave.ar.winstonToAr(transaction.quantity));
        id = transaction.id;
      }

      // Case: AR --> PST
      if (key === "Token") {
        fromCurrency = "AR";
        toCurrency = value;
        fromAmount = parseFloat(arweave.ar.winstonToAr(transaction.quantity));
        id = transaction.id;
      }
    }
  });

  // If ETH --> AR, toCurrency would not be set yet.
  if (fromCurrency === "ETH" && toCurrency === "") {
    toCurrency = "AR";
  }

  // Asyncronous logic that couldn't go in the forEach loop
  if (toCurrency !== "AR" && toCurrency !== "ETH") {
    // Has to be going to a PST
    toCurrency = await getTicker(toCurrency);
  } else if (fromCurrency !== "AR" && fromCurrency !== "ETH") {
    // Has to be coming from a PST
    fromCurrency = await getTicker(fromCurrency);
  }

  return {
    fromCurrency,
    toCurrency,
    fromAmount,
    id,
  };
}

/**
 * Gets the ticker of a given transaction
 * @param transactionID SmartWeave Contract ID
 * @returns Profit-Sharing Token Ticker (a string)
 */
async function getTicker(transactionID: string) {
  // Fetch the SmartWeave Contract Configuration that contains the ticker
  const res = await arweave.transactions.getData(transactionID, {
    decode: true,
    string: true,
  });
  // @ts-expect-error
  return (await JSON.parse(res)).ticker;
}
