import { IImportRepository } from "../../domain/repositories/import-repository.interface.js";

export class CancelImportUseCase {
  constructor(private importRepo: IImportRepository) {}

  async execute(id: string) {
    const imp = await this.importRepo.findById(id);
    if (!imp) {
      const err: any = new Error(`Import with id ${id} not found`);
      err.statusCode = 404;
      err.code = "IMPORT_NOT_FOUND";
      throw err;
    }

    if (["completed", "failed", "cancelled"].includes(imp.status)) {
      return {
        id: imp.id,
        status: imp.status,
        message: `Import is already in ${imp.status} state`,
      };
    }

    await this.importRepo.updateStatus(id, "cancelling");
    return {
      id: imp.id,
      status: "cancelling",
      message: "Import cancellation request submitted",
    };
  }
}
