import { SUTYERAK_ASSETS } from "./assets";

/**
 * SUTYERÁK FIGURÁJA, ÁLLAPOTONKÉNT MOZGÓ RÉTEGEKKEL (kártya e0780477;
 * Balázs, 2026-10-06, `exchange/sutyerak/animated-v1/`). A jóváhagyott
 * referencia az `elo-nezet.html`: rétegsorrend, százalékos pozíciók, forgási
 * pontok és időzítések onnan (`sutyerak-figure.css`).
 *
 * Csak megjelenít: az állapotot a widget adja. Minden póz rétegei egyszerre
 * vannak a DOM-ban, és csak az átlátszóságuk vált, így állapotváltáskor nincs
 * képbetöltés, villanás vagy ugrás. A figura dekoratív: a gomb címkéje
 * mondja ki, mi ez, a képek nem ismétlik meg.
 */
export type SutyerakFigureState =
  "resting" | "takingNotes" | "searching" | "answering" | "stuck";

/** A rétegek: a forrás 1254 px-es PNG-i 512 px-es, alfás WebP-ben (manifest.json). */
const LAYER = (name: string) => `/sutyerak/animated-v1/${name}.webp`;

export function SutyerakFigure({
  state,
  size,
}: {
  state: SutyerakFigureState;
  size: number;
}) {
  return (
    <span
      className="sut-fig"
      data-state={state}
      data-testid="sutyerak-figure"
      aria-hidden="true"
      style={{ width: size, height: size }}
    >
      <span className="sut-pose sut-pose-resting">
        <Layer name="pihen-para" />
        <Layer name="pihen-alap" />
        <Layer name="pihen-szem" className="sut-eyes" />
        <Layer name="pihen-szem-csukott" className="sut-eyes-closed" />
      </span>
      <span className="sut-pose sut-pose-takingNotes">
        <Layer name="jegyzetel-alap" />
        <span className="sut-note-placement">
          <Layer name="iro-ollo-ceruza" className="sut-pencil" />
        </span>
      </span>
      <span className="sut-pose sut-pose-searching">
        <Layer name="keres-alap" />
        <Layer name="nagyito-ollo" className="sut-glass" />
      </span>
      <span className="sut-pose sut-pose-answering">
        <Layer name="valaszol-alap" className="sut-answer-body" />
        <span className="sut-bubble-placement">
          <Layer name="beszedbuborek" className="sut-bubble" />
        </span>
      </span>
      {/* az elakadt jelzés a meglévő képpel marad, amíg az új nem készül el */}
      <span className="sut-pose sut-pose-stuck">
        {/* eslint-disable-next-line @next/next/no-img-element -- swappable local mascot assets */}
        <img
          className="sut-layer"
          src={SUTYERAK_ASSETS.stuck}
          alt=""
          draggable={false}
        />
      </span>
    </span>
  );
}

function Layer({ name, className }: { name: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- swappable local mascot layers
    <img
      className={className ? `sut-layer ${className}` : "sut-layer"}
      src={LAYER(name)}
      alt=""
      draggable={false}
      data-layer={name}
    />
  );
}
