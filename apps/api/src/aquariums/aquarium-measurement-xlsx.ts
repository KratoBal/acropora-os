import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import {
  aquariumMeasurementParametersFor,
  type AquariumMeasurementListResponse,
  type WaterType,
} from "@acropora/types";

const SHEET_NAME = "Mérési előzmények";

/**
 * A "Letöltés Excelben" a TELJES ELŐZMÉNYT ADJA, NEM A SZŰRT NÉZETET.
 *
 * A Figma terv a gombot a szűrt/lapozott táblázat fölé teszi (lásd a
 * brief 5. pontját), de egy export-fájl, ami csendben csak a képernyőn
 * épp látszó időszakot/paramétereket viszi, könnyen félrevezet -- valaki
 * letölti, később megnyitja, és nem emlékszik, milyen szűrő állt aznap.
 * Ezért ez a fájl MINDIG az akvárium teljes mérési előzményét adja, az
 * adott víztípus ÖSSZES paraméterével (nem csak a kijelölt chipekkel).
 */
@Injectable()
export class AquariumMeasurementXlsx {
  async build(input: {
    aquariumName: string;
    waterType: WaterType | undefined;
    measurements: AquariumMeasurementListResponse;
  }): Promise<Buffer> {
    const parameters = aquariumMeasurementParametersFor(input.waterType);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(SHEET_NAME);
    sheet.addRow([
      "Időpont",
      "Mérte",
      ...parameters.map((p) => `${p.label} (${p.unit})`),
      "Forrás",
      "Megjegyzés",
    ]);
    sheet.getRow(1).font = { bold: true };

    for (const occasion of input.measurements.occasions) {
      const byCode = new Map(
        occasion.values.map((v) => [v.parameterCode, v.value]),
      );
      sheet.addRow([
        new Date(occasion.measuredAt),
        occasion.measuredByName ?? "",
        ...parameters.map((p) => byCode.get(p.code) ?? null),
        occasion.source ?? "",
        occasion.notes ?? "",
      ]);
    }

    sheet.getColumn(1).numFmt = "yyyy-mm-dd hh:mm";
    sheet.columns.forEach((column) => {
      column.width = 18;
    });

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  /** A letöltött fájl neve -- lásd `InventoryCountXlsx` melletti mintát. */
  filename(aquariumName: string): string {
    const safe = aquariumName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    return `vizmeresi-elozmenyek-${safe || "akvarium"}.xlsx`;
  }
}
