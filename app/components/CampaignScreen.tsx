"use client";

import { useEffect, useRef } from "react";
import { REALMS } from "@/src/game3d/realms";
import {
  CHAPTERS, TOTAL_STARS, chapterOpen, goalLabel, nextEvent, starsIn, totalStars,
} from "@/src/ui/campaign";

interface Props {
  stars: Record<string, number>;
  carName: string;
  onPlay: (eventId: string) => void;
  onBack: () => void;
}

/**
 * THE DUSK LINE — the campaign map.
 *
 * Chapters run down the page in the order the sky does: golden hour, sunset,
 * night, then the finale. Each event card is the world it is raced in, so the
 * page reads as a route through the game rather than a list of fixtures, and
 * its three goals sit on the card with their stars, because "what do I have
 * to do here" is the question the card exists to answer.
 */
export default function CampaignScreen({ stars, carName, onPlay, onBack }: Props) {
  const total = totalStars(stars);
  const next = nextEvent(stars);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Land on the thing to play next, not the top of a long page.
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
    nextRef.current?.scrollIntoView({ block: "center" });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <div className="home campaign">
      <header className="camp-head">
        <button type="button" className="wiz-btn camp-back" onClick={onBack}>◂ MENU</button>
        <div className="camp-title">
          <h1 className="title" translate="no">THE DUSK LINE</h1>
          <p className="camp-sub">Twelve races into the night, and one to finish it. You drive your {carName}; change it in the garage.</p>
        </div>
        <div className="camp-total" aria-label={`${total} of ${TOTAL_STARS} stars`}>
          <strong>{total}<span>/ {TOTAL_STARS} ★</span></strong>
          <span className="camp-bar" aria-hidden="true"><i style={{ width: `${(total / TOTAL_STARS) * 100}%` }} /></span>
        </div>
      </header>

      {CHAPTERS.map((ch) => {
        const open = chapterOpen(ch, stars);
        const got = ch.events.reduce((n, e) => n + starsIn(stars[e.id] ?? 0), 0);
        return (
          <section key={ch.id} className={`camp-chapter ${open ? "" : "locked"} ${ch.events.length === 1 ? "finale" : ""}`} aria-labelledby={`ch-${ch.id}`}>
            <div className="camp-ch-head">
              <span className="camp-hour">{ch.hour}</span>
              <h2 id={`ch-${ch.id}`}>{ch.name}</h2>
              <span className="camp-ch-stars">{got} / {ch.events.length * 3} ★</span>
              <p>{open ? ch.blurb : `Earn ${ch.needStars} ★ to open — ${ch.needStars - total} to go.`}</p>
            </div>
            <div className="camp-events">
              {ch.events.map((ev) => {
                const mask = stars[ev.id] ?? 0;
                const isNext = next?.id === ev.id;
                return (
                  <button
                    type="button"
                    key={ev.id}
                    ref={isNext ? nextRef : undefined}
                    className={`camp-event ${isNext ? "next" : ""} ${starsIn(mask) === 3 ? "done" : ""}`}
                    aria-disabled={!open || undefined}
                    onClick={() => open && onPlay(ev.id)}
                  >
                    <span className="camp-art" aria-hidden="true">
                      <img src={`/previews/realm-${ev.realm}.webp`} alt="" width={480} height={270} decoding="async" />
                      {isNext && <span className="camp-next-flag">UP NEXT</span>}
                    </span>
                    <span className="camp-body">
                      <strong>{ev.title}</strong>
                      <span className="camp-where">
                        {REALMS[ev.realm].name} · {ev.mode === "endless" ? `${ev.targetKm} km run` : `${ev.laps} lap${ev.laps === 1 ? "" : "s"}`}
                      </span>
                      <span className="camp-brief">{ev.brief}</span>
                      <ul className="camp-goals">
                        {ev.goals.map((g, i) => {
                          const has = Boolean(mask & (1 << i));
                          return (
                            <li key={i} className={has ? "got" : ""}>
                              <span className="camp-star" aria-hidden="true">{has ? "★" : "☆"}</span>
                              <span>{goalLabel(g)}</span>
                              <span className="sr-only">{has ? " — earned" : " — not yet"}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
