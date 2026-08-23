import { IImportRepository } from '../../domain/repositories/import-repository.interface.js';

export class GetImportStatusUseCase {
  constructor(private importRepo: IImportRepository) {}

  async execute(id: string) {
    const imp = await this.importRepo.findById(id);
    if (!imp) {
      const err: any = new Error(`Import with id ${id} not found`);
      err.statusCode = 404;
      err.code = 'IMPORT_NOT_FOUND';
      throw err;
    }

    return {
      id: imp.id,
      status: imp.status,
      progress: {
        processed: imp.processedCount,
        accepted: imp.acceptedCount,
        rejected: imp.rejectedCount,
        duplicates: imp.duplicateCount,
      },
      startedAt: imp.startedAt ? imp.startedAt.toISOString() : null,
      completedAt: imp.completedAt ? imp.completedAt.toISOString() : null,
      failureReason: imp.failureReason || null,
    };
  }
}
