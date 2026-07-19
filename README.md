# Acropora ERP

Központi készlet-, bevételezési, POS-, UNAS- és Számlázz.hu integrációs rendszer.

## Első cél

1. UNAS termékek importálása.
2. Tömeges bevételezés a saját felületen.
3. Készletváltozás továbbítása az UNAS felé.
4. Webshop-rendelések tükrözése.
5. Számlázható rendelés automatikus számlázása, majd a számlaszám visszaírása az UNAS-ba.

## Indítás fejlesztői környezetben

1. Másold le a `.env.example` fájlt `.env` néven.
2. Töltsd ki az adatbázis- és API-beállításokat.
3. Indítsd a szolgáltatásokat:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

## Következő fejlesztési lépés

Az első futó modul az `UNAS connection test` lesz: belépés, terméklekérés, készlet lekérés és teszt készletmozgás.
