# A meres-kapu fixturai -- VALODI FUTASOK KIVAGOTT RESZLETEI

Egyik sem kitalalt TAP-szoveg. Mindharom egy megnevezett GitHub-futas naplojabol
van kivagva, es a futas a branch torlese utan is lehivhato:

| fajl          | futas       | mit mutat                                                                        |
| ------------- | ----------- | -------------------------------------------------------------------------------- |
| `teljes.log`  | 35003588230 | a masodik visszaolvaso kor: a brands blokk ES a medusa masodik neve is megjelent |
| `hianyos.log` | 35001520746 | az elso kor: a brands suite EL SEM INDULT, a medusa masodik neve hianyzik        |
| `zold.log`    | 35000681174 | rendes, zold futas a fo agon: egyetlen takaritas-szamlalo sem sult el            |

A harom kozti KULONBSEG a lenyeg, nem a meretuk. Az elso kivagasom a ket
meres-korbol BETURE AZONOS reszletet adott (mindketto ugyanugy kezdodik), tehat
nem tudta volna szetvalasztani oket -- egy fixtura, ami a ket esetre ugyanazt
adja, nem meri a kulonbseget. Ezert a vagas a MEGKULONBOZTETO tartalomra megy:
a brands blokkra es a `lekepezes-sorai` nevre.

A lehivas (az ag nelkul is mukodik):

    GET https://api.github.com/repos/KratoBal/acropora-os/actions/runs/<id>/logs

FIGYELEM, MERVE 2026-09-15: a GitHub a REGEBBI futasok LEPES-SZINTU naplofajljait
kitomoriti; a 35000681174-nel mar csak az osszevont `3_verify.txt` letezett, a
`verify/16_Database integration tests.txt` nem. A futas maga es az osszevont
naplo megmaradt. Aki ezekre a fixturakra epit, ezert talalja itt oket.
