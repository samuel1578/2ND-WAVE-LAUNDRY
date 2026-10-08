import { Action, Empty } from "@/components/ui";
export default function NotFound() {
  return (
    <main id="main" className="container public-main">
      <Empty
        title="We couldn’t find that page"
        body="The link may have changed or the page may no longer be available."
      >
        <div className="actions">
          <Action href="/">Return Home</Action>
          <Action href="/services" secondary>
            Explore Services
          </Action>
        </div>
      </Empty>
    </main>
  );
}
