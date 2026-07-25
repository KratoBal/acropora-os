import type { UnasParsedWorkbook } from "@acropora/types";
export declare class UnasXlsxParser {
    parse(buffer: Buffer): Promise<UnasParsedWorkbook>;
}
