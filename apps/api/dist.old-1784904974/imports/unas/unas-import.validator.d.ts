import type { ImportRowResult, UnasParsedWorkbook, UnasProductImportRow } from "@acropora/types";
export declare class UnasImportValidator {
    validate(workbook: UnasParsedWorkbook): ImportRowResult<UnasProductImportRow>[];
}
