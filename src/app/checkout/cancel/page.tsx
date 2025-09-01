export default function CancelPage() {
  return (
    <main className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-2xl font-semibold">Checkout canceled</h1>
      <p className="mt-2 text-gray-200">No charge was made. You can try again or contact us if you need help.</p>
      <a href="/#pricing" className="mt-6 inline-block rounded-lg border px-4 py-2">Return to Pricing</a>
    </main>
  );
}
