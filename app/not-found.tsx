import Link from "next/link";
export default function NotFound() {
  return (
    <section className="section">
      <p className="eyebrow">404</p>
      <h1 className="text-4xl">That page isn’t here.</h1>
      <Link href="/" className="button mt-8">
        Back to Wissen
      </Link>
    </section>
  );
}
