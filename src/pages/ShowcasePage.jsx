import { useState } from "react";
import { products } from "../data/products";
import TopBar from "../components/TopBar";
import { ArrowRight } from "../components/Icons";

export default function ShowcasePage({ onNavigate, theme, onToggleTheme, a11y, onA11yChange }) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = products.find((p) => p.id === selectedId);

  const toPoll = () => onNavigate("poll");

  if (selected) {
    return (
      <main className="page wide">
        <TopBar
          onBack={() => setSelectedId(null)}
          backLabel="Back to products"
          theme={theme}
          onToggleTheme={onToggleTheme}
          a11y={a11y}
          onA11yChange={onA11yChange}
        />
        <article className="detail">
          <img
            className="detail-img"
            src={selected.image}
            alt={`${selected.name} ${selected.category}`}
            style={{ "--glow": selected.glow }}
          />
          <div className="detail-copy glass">
            <p className="eyebrow">{selected.category}</p>
            <h1 className="serif">{selected.name}</h1>
            <p className="shade">{selected.shade}</p>
            <p className="muted">{selected.tagline}</p>
            <button type="button" className="btn primary block" onClick={toPoll}>
              Continue to Live Poll <ArrowRight />
            </button>
            <button type="button" className="btn ghost block" onClick={() => setSelectedId(null)}>
              Back to all shades
            </button>
          </div>
        </article>
      </main>
    );
  }

  return (
    <main className="page wide">
      <TopBar
        onBack={() => onNavigate("")}
        backLabel="Back to welcome"
        theme={theme}
        onToggleTheme={onToggleTheme}
        a11y={a11y}
        onA11yChange={onA11yChange}
      />
      <section className="intro">
        <p className="eyebrow">Peptide Lip Tint</p>
        <h1 className="serif">Meet the shades</h1>
      </section>

      <ul className="product-grid">
        {products.map((p) => (
            <li key={p.id}>
              <article className="product-card" style={{ "--tint": p.glow }}>
                <img src={p.image} alt={`${p.name} ${p.category}`} />
                <div className="product-info">
                  <h2 className="serif">{p.name}</h2>
                  <p>{p.shade}</p>
                  <button type="button" className="product-btn" aria-label={`View shade: ${p.name}`} onClick={() => setSelectedId(p.id)}>
                    View shade
                  </button>
                </div>
              </article>
            </li>
        ))}
      </ul>

      <div className="cta-row">
        <button type="button" className="btn primary" onClick={toPoll}>
          Continue to Live Poll <ArrowRight />
        </button>
      </div>
    </main>
  );
}
