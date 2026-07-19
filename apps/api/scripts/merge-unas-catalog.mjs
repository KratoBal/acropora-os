import { resolve } from "node:path";

import ExcelJS from "exceljs";

const [, , productsPath, categoriesPath, outputPath] = process.argv;
if (!productsPath || !categoriesPath || !outputPath) {
  throw new Error(
    "Usage: node merge-unas-catalog.mjs <products.xlsx> <categories.xlsx> <output.xlsx>",
  );
}

async function copySingleSheet(sourcePath, target, targetName) {
  const source = new ExcelJS.Workbook();
  await source.xlsx.readFile(resolve(sourcePath));
  if (source.worksheets.length !== 1) {
    throw new Error(`${sourcePath}: exactly one worksheet is required.`);
  }
  const output = target.addWorksheet(targetName);
  source.worksheets[0].eachRow({ includeEmpty: true }, (row) => {
    output.addRow(row.values.slice(1));
  });
}

const target = new ExcelJS.Workbook();
await copySingleSheet(productsPath, target, "Products");
await copySingleSheet(categoriesPath, target, "Categories");
await target.xlsx.writeFile(resolve(outputPath));
