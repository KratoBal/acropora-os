-- A helyi, ACROPORA-authority termékek emberileg olvasható, automatikus
-- belső cikkszámaihoz használt adatbázis-szekvencia.
--
-- A nextval párhuzamos tranzakciók között is egyedi értéket ad. A
-- tranzakció-visszagörgetés szándékosan hagyhat sorszámhézagot; a cikkszám
-- azonosító, nem folyamatos bizonylatsorszám.
CREATE SEQUENCE "LocalProductSkuSequence"
  AS BIGINT
  INCREMENT BY 1
  MINVALUE 1
  START WITH 1
  CACHE 1;
