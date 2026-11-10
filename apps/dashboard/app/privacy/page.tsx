import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "KOS Raffles Privacy Policy" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/about" className="text-sm underline">
        KOS Raffles
      </Link>
      <article className="mt-6 space-y-4 leading-relaxed [&_a]:underline">
        <h1 className="text-3xl font-semibold">KOS Raffles Privacy Policy</h1>
        <p>Effective date: November 10, 2026</p>
        <p>
          KOS Raffles is operated by KOS. Adebayo Daniel Oluwatosin is the
          privacy contact for KOS. This policy explains how KOS Raffles handles
          information when people enter raffles, manage communities, or connect
          Google Sheets.
        </p>
        <h2 className="pt-4 text-xl font-semibold">Information we process</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Accounts and communities.</strong> We use Discord account
            and server information to sign you in, determine community
            membership and roles, and give you access to the appropriate
            features. If you link another account, we use the connection to
            support the features you enable.
          </li>
          <li>
            <strong>Participation.</strong> We record raffle entries, results,
            task completion and proof, and related community activity to operate
            raffles and show participants and authorized community teams their
            activity.
          </li>
          <li>
            <strong>Wallet addresses.</strong> If you submit a wallet address,
            we use it to check raffle requirements, record the address for the
            relevant network, and prepare winner exports for reward
            distribution. KOS stores submitted wallet addresses encrypted in its
            database.
          </li>
          <li>
            <strong>Sessions and operational records.</strong> We use session
            cookies to keep you signed in and maintain operational and audit
            records to troubleshoot the service and track administrative
            actions.
          </li>
        </ul>
        <h2 className="pt-4 text-xl font-semibold">
          Optional Google Sheets connection
        </h2>
        <p>
          A community administrator can authorize KOS Raffles to create and
          maintain winner spreadsheets in the connected Google account. Google
          provides the account identifier and email address, granted
          permissions, and OAuth tokens. KOS stores the account identity,
          granted permissions, and an encrypted refresh token with the
          community’s connection. It uses the refresh token to obtain
          short-lived access tokens so it can update sheets after the
          administrator leaves the dashboard. KOS also records which KOS account
          connected Google and keeps an audit entry for the connection.
        </p>
        <p>
          KOS requests Google’s file-level permission to create, update, and
          manage sharing for the spreadsheets it creates for this feature. It
          uses Google Sheets and Google Drive APIs to write the export and apply
          sharing permissions. It sends editor email addresses configured by the
          community administrator to Google to grant edit access.
        </p>
        <p>
          Winner exports can include the project name, wallet addresses,
          blockchain networks, and winner-list categories. The Google Sheets
          export omits Discord usernames. KOS configures these sheets so{" "}
          <strong>anyone with the link can view them</strong>. The connected
          Google account can manage access in Drive. People with access may copy
          or forward the information.
        </p>
        <p>
          KOS Raffles’ use and transfer of information received from Google APIs
          will adhere to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements. We use Google account and
          file data to provide and maintain this integration. We do not sell
          that data or use it for advertising.
        </p>
        <h2 className="pt-4 text-xl font-semibold">Who can see information</h2>
        <p>
          Authorized community teams can access records for their community
          according to their permissions. Raffle results may be published in
          Discord, Telegram, or on public raffle pages depending on how the
          raffle is run. When a community exports a winner list or shares a
          winner spreadsheet with a partner, the recipients can use the exported
          information to distribute rewards. Hosting and database providers
          process information to operate the service.
        </p>
        <h2 className="pt-4 text-xl font-semibold">
          Retention, disconnection, and deletion
        </h2>
        <p>
          We keep account and participation records, raffle proofs, and audit
          records for as long as needed to operate the service, preserve raffle
          results, investigate abuse, or meet legal obligations. You can request
          deletion by contacting us below. We review requests against these
          needs and any applicable legal requirements. Copies in backups may
          remain until the backups expire.
        </p>
        <p>
          A community administrator can disconnect Google Sheets in KOS
          settings. This removes the active connection and its stored refresh
          token from KOS. Connection events may remain in audit records. To
          revoke the grant with Google, remove KOS Raffles from your{" "}
          <a href="https://myaccount.google.com/connections">
            Google Account connections
          </a>
          .
        </p>
        <p>
          Spreadsheets already created remain in the connected Google account
          after disconnection. The account owner can restrict sharing or delete
          the spreadsheets directly in Drive. Copies that recipients have
          already made are controlled by those recipients.
        </p>
        <h2 className="pt-4 text-xl font-semibold">Privacy requests</h2>
        <p>
          Contact Adebayo Daniel Oluwatosin at{" "}
          <a href="mailto:oluwatosindaniel414@gmail.com">
            oluwatosindaniel414@gmail.com
          </a>{" "}
          to ask about this policy or request access, correction, or deletion of
          personal information held by KOS Raffles.
        </p>
      </article>
    </main>
  );
}
