import { ITransactionRepository } from "../../domain/repositories/transaction-repository.interface.js";

export class GetSummaryUseCase {
  constructor(private transactionRepo: ITransactionRepository) {}

  async execute(importId: string) {
    const summary = await this.transactionRepo.getSummaryByImportId(importId);
    if (!summary) {
      const err: any = new Error(`Import summary for ${importId} not found`);
      err.statusCode = 404;
      err.code = "IMPORT_NOT_FOUND";
      throw err;
    }
    return summary;
  }
}
