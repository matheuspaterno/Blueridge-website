export const metadata = {
  title: "Privacy Policy | Blueridge AI",
  description: "Blueridge AI Privacy Policy",
};

export default function PrivacyPolicyPage() {
  const effective = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(new Date());
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-gray-500">Effective date: {effective}</p>

        <div className="prose prose-gray mt-8">
          <p>
            This Privacy Policy explains how Blueridge AI ("we", "our", "us") collects, uses, and
            protects your information when you use our website, chat assistant, scheduling tools, and
            related services (the "Services").
          </p>

          <h2>Information we collect</h2>
          <ul>
            <li>
              Contact details you provide (for example: name, email address, phone number) when
              requesting information or booking an appointment.
            </li>
            <li>
              Chat messages and form inputs submitted through our site to help facilitate support and
              scheduling.
            </li>
            <li>
              Scheduling details (for example: requested time windows, calendar event metadata such as
              title, start/end time, attendees). We do not access your calendar content beyond what is
              needed to check availability and create or cancel events with your permission.
            </li>
            <li>
              Billing metadata for subscriptions or purchases processed by our payment provider. We do
              not store full payment card numbers on our servers.
            </li>
            <li>
              Basic usage and device information (such as IP address, browser type, and pages viewed)
              to improve site performance and reliability.
            </li>
          </ul>

          <h2>How we use your information</h2>
          <ul>
            <li>To provide the Services, including scheduling, reminders, and customer support.</li>
            <li>To operate, maintain, and improve our website and user experience.</li>
            <li>To communicate with you about bookings, updates, and service-related messages.</li>
            <li>To comply with legal obligations and enforce our terms.</li>
          </ul>

          <h2>Service providers and data sharing</h2>
          <p>
            We may share information with trusted service providers who process data on our behalf to
            deliver the Services. These may include:
          </p>
          <ul>
            <li>Google (Calendar) for availability checks and creating events when authorized by you.</li>
            <li>Stripe for secure payment processing (we do not store full card details).</li>
            <li>OpenAI to process chat interactions when you use our assistant.</li>
            <li>Supabase for application data storage.</li>
            <li>Email delivery providers for transactional messages (for example, confirmations).</li>
          </ul>
          <p>
            We do not sell your personal information. We disclose data only as necessary to provide the
            Services, comply with law, or protect our rights.
          </p>

          <h2>Data retention</h2>
          <p>
            We retain information for as long as needed to provide the Services and for legitimate
            business or legal purposes. When data is no longer required, we will delete or anonymize it
            in accordance with our retention practices.
          </p>

          <h2>Your choices and rights</h2>
          <ul>
            <li>You can request access, correction, or deletion of your personal information.</li>
            <li>You can revoke Google Calendar access at any time via your Google account settings.</li>
            <li>You can unsubscribe from non-essential communications where applicable.</li>
          </ul>

          <h2>Security</h2>
          <p>
            We use commercially reasonable safeguards to protect your information. However, no method of
            transmission or storage is completely secure, and we cannot guarantee absolute security.
          </p>

          <h2>Children&apos;s privacy</h2>
          <p>
            Our Services are not directed to children under 13, and we do not knowingly collect personal
            information from children under 13.
          </p>

          <h2>International users</h2>
          <p>
            If you access the Services from outside your country, you consent to processing and storage
            of your information in jurisdictions where we or our providers operate.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Material changes will be posted on this
            page with an updated effective date.
          </p>

          <h2>Contact us</h2>
          <p>
            If you have questions about this Privacy Policy or our data practices, contact us at
            <br />
            <a className="text-blue-600 underline" href="mailto:services@blueridge-ai.com">services@blueridge-ai.com</a>
          </p>

          <hr />
          <p className="text-sm text-gray-500">
            Need a copy? You can download the document version here: {" "}
            <a className="text-blue-600 underline" href="/Privacy Policy.docx" download>
              Privacy Policy (.docx)
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
