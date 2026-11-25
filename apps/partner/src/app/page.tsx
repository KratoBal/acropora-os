import { redirect } from "next/navigation";

export default function HomePage() {
  // a kezdőlap az áttekintés: a partner teendői (kártya 28f31715)
  redirect("/attekintes");
}
