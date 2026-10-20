/**
 * The ReefClub start page. The first slice only gives the web resource
 * something to build and serve; the sign-in and the aquarium pages follow in
 * the next slices of the same task (reefclub-szelet-9).
 */
export default function ReefClubHome() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">ReefClub</h1>
      <p className="mt-3 text-sm text-pilot-grey-600">
        Teszt környezet. A felület építés alatt van.
      </p>
    </main>
  );
}
