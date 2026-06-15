import { Logo, Mark } from "../Logo";

export const metadata = {
  title: "sip402 · brand",
  description: "The sip402 mark, wordmark, and downloadable logo assets.",
};

function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-9 w-9 rounded-lg border border-hairline-soft" style={{ background: hex }} />
      <div className="leading-tight">
        <div className="text-[13px] font-bold text-ink">{name}</div>
        <div className="font-mono text-[12px] text-ink-mute">{hex}</div>
      </div>
    </div>
  );
}

export default function BrandPage() {
  return (
    <main className="mx-auto max-w-[1080px] px-5 py-16 sm:px-8">
      <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-primary">Brand</p>
      <h1 className="mt-2 text-[34px] font-bold tracking-tight text-ink">The sip402 mark</h1>
      <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-secondary">
        A cobalt app-icon tile with a white &ldquo;sip&rdquo; droplet and a payment slot — a nod to
        x402&rsquo;s <span className="font-bold">Payment Required</span>, metered one sip at a time.
        Grab the files below for the submission, socials, or anywhere.
      </p>

      {/* hero mark on light + dark */}
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col items-center justify-center gap-5 rounded-3xl border border-hairline-soft bg-canvas-soft p-12">
          <Mark size={168} rounded={40} />
          <Logo size={34} />
        </div>
        <div className="flex flex-col items-center justify-center gap-5 rounded-3xl border border-hairline-soft p-12" style={{ background: "#0a1417" }}>
          <Mark size={168} rounded={40} />
          <span className="inline-flex items-center gap-2.5">
            <span className="text-[34px] font-bold tracking-tight text-white" style={{ letterSpacing: "-0.02em" }}>
              sip<span style={{ color: "#3B92FF" }}>402</span>
            </span>
          </span>
        </div>
      </div>

      {/* size ladder */}
      <div className="mt-10 rounded-3xl border border-hairline-soft p-8">
        <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink-mute">Scales clean</p>
        <div className="mt-5 flex flex-wrap items-end gap-8">
          {[96, 64, 40, 28, 20, 16].map((s) => (
            <div key={s} className="flex flex-col items-center gap-2">
              <Mark size={s} rounded={Math.max(4, s / 4)} />
              <span className="font-mono text-[11px] text-ink-mute">{s}px</span>
            </div>
          ))}
        </div>
      </div>

      {/* downloads + colors */}
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <div className="rounded-3xl border border-hairline-soft p-8">
          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink-mute">Download</p>
          <div className="mt-4 flex flex-col gap-2.5">
            {[
              { label: "icon.svg — vector", href: "/icon.svg" },
              { label: "icon-512.png — square", href: "/icon-512.png" },
              { label: "icon-1024.png — square @2x", href: "/icon-1024.png" },
            ].map((d) => (
              <a
                key={d.href}
                href={d.href}
                download
                className="flex items-center justify-between rounded-xl border border-hairline-soft px-4 py-3 text-[14px] font-bold text-ink transition-colors hover:bg-canvas-soft"
              >
                {d.label}
                <span className="text-primary">↓</span>
              </a>
            ))}
          </div>
        </div>
        <div className="rounded-3xl border border-hairline-soft p-8">
          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink-mute">Palette</p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Swatch name="Cobalt" hex="#0064E0" />
            <Swatch name="Cobalt deep" hex="#0050CC" />
            <Swatch name="Ink" hex="#0A1417" />
            <Swatch name="Canvas" hex="#FFFFFF" />
          </div>
        </div>
      </div>
    </main>
  );
}
