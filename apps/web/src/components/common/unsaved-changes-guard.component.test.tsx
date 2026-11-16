import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnsavedChangesGuard } from "./unsaved-changes-guard";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

/*
  AZ ALKALMAZÁSON BELÜLI KILÉPÉS ŐRE (Luca: „az oldalsávval lépek ki"). MI PIROSÍT: ha egy belső hivatkozás
  mentetlen változásnál kérdés nélkül elvisz; ha a kérdés nélkül elmentett állapotban is megállít; ha a
  módosított kattintás, az új lapos, a külső vagy az azonos oldalra mutató hivatkozás is megáll; ha a mégsem a
  router hívásával jár; ha a megerősítés nem a hivatkozás címére visz.
*/
function Page({ when }: { when: boolean }) {
  return (
    <div>
      <UnsavedChangesGuard when={when} />
      <nav>
        <a href="/partnerek">Partnerek</a>
        <a href="/szerviz?tab=1#fent">Szerviz</a>
        <a href="/partnerek" target="_blank">
          Új lapon
        </a>
        <a href="https://kulso.example/oldal">Külső</a>
        <a href={window.location.pathname + "#horgony"}>Ugyanide</a>
        <a href="/letolt" download>
          Letöltés
        </a>
      </nav>
    </div>
  );
}

const stopNavigation = (event: Event) => event.preventDefault();

describe("UnsavedChangesGuard", () => {
  beforeEach(() => {
    navigation.push.mockClear();
    // a tesztkörnyezet a le nem tiltott hivatkozás-kattintásra tényleges lekérést indítana
    document.addEventListener("click", stopNavigation);
  });
  afterEach(() => document.removeEventListener("click", stopNavigation));

  it("mentetlen változásnál a belső hivatkozás előtt kérdez, és csak megerősítésre visz oda", () => {
    render(<Page when />);
    fireEvent.click(screen.getByText("Szerviz"));
    expect(
      screen.getByText("Kilépsz a mentetlen változtatásokkal?"),
    ).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Kilépés mentés nélkül"));
    expect(navigation.push).toHaveBeenCalledWith("/szerviz?tab=1#fent");
  });

  it("a mégsem marad az oldalon, és a kérdés bezárul", () => {
    render(<Page when />);
    fireEvent.click(screen.getByText("Partnerek"));
    fireEvent.click(screen.getByText("Mégsem"));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Kilépsz a mentetlen változtatásokkal?"),
    ).toBeNull();
  });

  it("elmentett állapotban nem állít meg semmit", () => {
    render(<Page when={false} />);
    const link = screen.getByText("Partnerek");
    fireEvent.click(link);
    expect(
      screen.queryByText("Kilépsz a mentetlen változtatásokkal?"),
    ).toBeNull();
  });

  it("a módosított kattintás, az új lapos, a letöltő, a külső és az azonos oldalra mutató hivatkozás nem áll meg", () => {
    render(<Page when />);
    // az őr elfogó fázisban fut: ha megállított egy kattintást, mire a buborékoló figyelőhöz ér, már le van
    // tiltva. A figyelő rögzíti ezt, és maga állítja meg a böngésző-navigációt (a tesztkörnyezet különben
    // ténylegesen elindítaná).
    const stopped: boolean[] = [];
    const record = (event: Event) => {
      stopped.push(event.defaultPrevented);
      event.preventDefault();
    };
    document.removeEventListener("click", stopNavigation);
    document.addEventListener("click", record);
    fireEvent.click(screen.getByText("Partnerek"), { ctrlKey: true });
    fireEvent.click(screen.getByText("Partnerek"), { button: 1 });
    fireEvent.click(screen.getByText("Új lapon"));
    fireEvent.click(screen.getByText("Letöltés"));
    fireEvent.click(screen.getByText("Külső"));
    fireEvent.click(screen.getByText("Ugyanide"));
    document.removeEventListener("click", record);
    expect(stopped).toEqual([false, false, false, false, false, false]);
    expect(
      screen.queryByText("Kilépsz a mentetlen változtatásokkal?"),
    ).toBeNull();
  });

  it("a változás megszűnése (mentés) után a következő kattintás már nem állít meg", () => {
    const { rerender } = render(<Page when />);
    rerender(<Page when={false} />);
    fireEvent.click(screen.getByText("Partnerek"));
    expect(
      screen.queryByText("Kilépsz a mentetlen változtatásokkal?"),
    ).toBeNull();
  });

  it("a böngésző kilépés-kérdése is csak mentetlen állapotban él", () => {
    const { rerender } = render(<Page when={false} />);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    rerender(<Page when />);
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
