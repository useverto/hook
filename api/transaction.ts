import { NowRequest, NowResponse } from "@vercel/node";
import Arweave from "arweave";
import webhook from "webhook-discord";
import Verto from "@verto/lib";
import { tx } from "ar-gql";
import { GQLNodeInterface } from "ar-gql/dist/types";

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
    transaction = await tx(transactionID),
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
        : `https://orbit.verto.exchange/order?id=${necessaryInfo.id}`;

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
async function checkEligibility(transaction: GQLNodeInterface) {
  let isMining: boolean = transaction.block ? false : true;

  let vertoTag: boolean = transaction.tags.find(
    (tag) => tag.name === "Exchange" && tag.value === "Verto"
  )
    ? true
    : false;

  let toTradingPost: boolean =
    transaction.recipient === "WNeEQzI24ZKWslZkQT573JZ8bhatwDVx6XVDrrGbUyk" ||
    transaction.recipient === "dxGmt44SZenqmHa-_IEl8AmuejgITs4pB3oe-xUR36A";

  if (isMining && vertoTag && toTradingPost) return true;
  else return false;
}

/**
 * Fetches the "necessary information" for the webhook
 * @param transaction Arweave Transaction
 * @returns fromCurrency, toCurrency, fromAmount, id
 */
async function getNecessaryInfo(
  transaction: GQLNodeInterface
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

  transaction.tags.forEach(({ name, value }) => {
    // If quantity is zero, we're dealing with an ETH or PST input
    if (transaction.quantity.winston === "0") {
      // Case: PST --> AR
      if (name === "Contract") {
        fromCurrency = value;
        toCurrency = "AR";
      }
      if (name === "Input") {
        let input = JSON.parse(value);
        fromAmount = input.qty;
        id = transaction.id;
      }

      // Case: ETH --> AR
      if (name === "Chain" && value === "ETH") {
        fromCurrency = "ETH";
      }
      if (name === "Hash") {
        id = value;
      }
      if (name === "Value") {
        fromAmount = parseFloat(value);
      }

      // Case: ETH --> PST
      if (name === "Token") {
        toCurrency = value;
      }
    } else {
      // Case: AR --> ETH
      if (name === "Chain" && value === "ETH") {
        fromCurrency = "AR";
        toCurrency = "ETH";
        fromAmount = parseFloat(
          arweave.ar.winstonToAr(transaction.quantity.winston)
        );
        id = transaction.id;
      }

      // Case: AR --> PST
      if (name === "Token") {
        fromCurrency = "AR";
        toCurrency = value;
        fromAmount = parseFloat(
          arweave.ar.winstonToAr(transaction.quantity.winston)
        );
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
