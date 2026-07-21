import { CREDITS, CREDITS_NOTE } from '../../game/credits';

// ─────────────────────────────────────────────────────────
// Tela de créditos — cartão rolável sobre a floresta, no estilo pixel
// do jogo. Reúne as atribuições de arte, áudio, fontes e tecnologia.
// ─────────────────────────────────────────────────────────
export default function Credits({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#04120a' }}>
      {/* fundo floresta */}
      <img src="/escape-assets/landing-forest.png" alt="" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        objectFit: 'cover', objectPosition: 'center top', pointerEvents: 'none',
        filter: 'brightness(0.5) saturate(0.85)',
      }} />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(3,12,6,0.55)', pointerEvents: 'none' }} />

      {/* botão voltar */}
      <button onClick={onBack} className="font-pixel" style={{
        position: 'absolute', top: 16, left: 14, zIndex: 20, fontSize: 9,
        color: '#cfe8c0', background: 'rgba(8,24,12,0.85)', border: '2px solid #2f6b34',
        padding: '9px 12px', cursor: 'pointer',
      }}>
        ← VOLTAR
      </button>

      {/* conteúdo rolável */}
      <div style={{
        position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        padding: '68px 16px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <div style={{ width: '100%', maxWidth: 560 }}>
          <h1 className="font-pixel" style={{
            fontSize: 16, color: '#f0c840', textAlign: 'center', lineHeight: 1.6,
            textShadow: '0 2px 0 #0d2a0d, 0 0 12px rgba(240,200,64,0.4)', marginBottom: 6,
          }}>
            CRÉDITOS
          </h1>
          <p className="font-pixel" style={{
            fontSize: 8, color: '#9fc48a', textAlign: 'center', lineHeight: 1.7, marginBottom: 22,
          }}>
            Projeto Amazônia · Prof. Corujão
          </p>

          {CREDITS.map(section => (
            <section key={section.heading} style={{ marginBottom: 22 }}>
              <h2 className="font-pixel" style={{
                fontSize: 10, color: '#7fe0a0', letterSpacing: 1, marginBottom: 10,
                paddingBottom: 6, borderBottom: '1px solid rgba(127,224,160,0.35)',
                textShadow: '0 1px 0 #0d2a0d',
              }}>
                {section.heading}
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {section.items.map(item => (
                  <div key={item.title} style={{
                    background: 'rgba(8,22,12,0.82)', border: '1px solid #2f6b34',
                    borderRadius: 6, padding: '10px 12px',
                  }}>
                    <div className="font-pixel" style={{ fontSize: 9, color: '#eaf6e0', lineHeight: 1.5 }}>
                      {item.title}
                      {item.author && (
                        <span style={{ color: '#9fc48a' }}>{'  ·  '}{item.author}</span>
                      )}
                    </div>
                    {item.note && (
                      <div style={{ fontSize: 11, color: '#c7dcbb', lineHeight: 1.5, marginTop: 5 }}>
                        {item.note}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 6 }}>
                      {item.license && (
                        <span className="font-pixel" style={{
                          fontSize: 7, color: '#f0c840', background: 'rgba(0,0,0,0.35)',
                          border: '1px solid rgba(240,200,64,0.4)', borderRadius: 4, padding: '3px 6px',
                        }}>
                          {item.license}
                        </span>
                      )}
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer" style={{
                          fontSize: 11, color: '#7fd0ff', textDecoration: 'underline', wordBreak: 'break-all',
                        }}>
                          {item.url.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <p style={{
            fontSize: 11, color: '#9fc48a', lineHeight: 1.6, textAlign: 'center',
            marginTop: 8, padding: '0 6px', fontStyle: 'italic',
          }}>
            {CREDITS_NOTE}
          </p>

          <p className="font-pixel" style={{
            fontSize: 8, color: '#6f9a5f', textAlign: 'center', lineHeight: 1.7, marginTop: 20,
          }}>
            Feito com carinho para a educação. 🦉🌱
          </p>
        </div>
      </div>
    </div>
  );
}
