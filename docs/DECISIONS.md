# Döntési napló

## ADR-001 – A készlet elsődleges gazdája

**Döntés:** az Acropora ERP a készlet elsődleges nyilvántartása. Az UNAS az eladható webshopkészlet tükrét kapja.

## ADR-002 – Készletmozgás alapú modell

**Döntés:** minden változást megváltoztathatatlan készletmozgásként rögzítünk. Hibás bizonylatot ellenmozgással javítunk.

## ADR-003 – Külső integrációk queue-n keresztül

**Döntés:** UNAS- és Számlázz.hu-hívások háttérfeladatként futnak, egyedi idempotencia-kulccsal.

## ADR-004 – Bevételezéskor relatív készletváltozás

**Döntés:** normál bevételezés és eladás során `in/out` jellegű relatív változást küldünk. Teljes készletérték felülírása csak leltáregyeztetéskor használható.
