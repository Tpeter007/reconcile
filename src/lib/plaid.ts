import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

type PlaidEnv = keyof typeof PlaidEnvironments;

const env: PlaidEnv = (process.env.PLAID_ENV as PlaidEnv) ?? "sandbox";

export const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID ?? "",
        "PLAID-SECRET": process.env.PLAID_SECRET ?? "",
        "Plaid-Version": "2020-09-14",
      },
    },
  }),
);
