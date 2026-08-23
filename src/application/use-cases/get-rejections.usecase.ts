import { IRejectionRepository } from "../../domain/repositories/rejection-repository.interface.js";
import { IImportRepository } from "../../domain/repositories/import-repository.interface.js";

export class GetRejectionsUseCase {
  constructor(
    private rejectionRepo: IRejectionRepository,
    private importRepo: IImportRepository,
  ) {}

  async execute(importId: string, limitInput?: number, cursorInput?: number) {
    const imp = await this.importRepo.findById(importId);
    if (!imp) {
      const err: any = new Error(`Import with id ${importId} not found`);
      err.statusCode = 404;
      err.code = "IMPORT_NOT_FOUND";
      throw err;
    }

    const limit = Math.min(Math.max(1, limitInput || 50), 100);
    const cursor =
      cursorInput !== undefined && !isNaN(cursorInput)
        ? cursorInput
        : undefined;

    return await this.rejectionRepo.findByImportIdPaginated(
      importId,
      limit,
      cursor,
    );
  }
}
