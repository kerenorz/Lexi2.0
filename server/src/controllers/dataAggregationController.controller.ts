import { Request, Response } from 'express';
import { dataAggregationService } from '../services/dataAggregation.service';
import { experimentsService } from '../services/experiments.service';
import { requestHandler } from '../utils/requestHandler';
import { AppError } from '../utils/errors';

/**
 * Export ownership check. requireRole only proves the caller is a researcher, and experiment
 * ids are public (participant URLs). 404, not 403, so ids can't be probed.
 * Not used for getPilotExcel, which is scoped to req.user._id and may pilot others' studies.
 */
const assertOwnsExperiment = async (req: Request, experimentId: string): Promise<void> => {
    if (typeof experimentId !== 'string' || !experimentId) {
        throw new AppError('Missing experiment id', 400, 'INVALID_EXPERIMENT_ID');
    }
    if (req.user?.role === 'admin') return;
    const experiment = await experimentsService.getExperiment(experimentId);
    if (!experiment || String(experiment.ownerId ?? '') !== String(req.user._id)) {
        throw new AppError('Experiment not found', 404, 'EXPERIMENT_NOT_FOUND');
    }
};

class DataAggregationController {
    getExperimentData = requestHandler(async (req: Request, res: Response) => {
        const experimentId = req.query.experimentId as string;
        await assertOwnsExperiment(req, experimentId);
        const response = await dataAggregationService.getExperimentData(experimentId);
        res.status(200).send({ message: response });
    });

    getExperimentExcel = requestHandler(async (req, res) => {
        const experimentId = req.query.experimentId as string;
        await assertOwnsExperiment(req, experimentId);
        const workbook = await dataAggregationService.createExperimentDataExcel(experimentId);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=ExperimentData.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    });

    // The caller's own pilot runs. The owner must come from req.user, never from the client.
    getPilotExcel = requestHandler(async (req, res) => {
        const experimentId = req.query.experimentId as string;
        const workbook = await dataAggregationService.createPilotDataExcel(experimentId, req.user._id);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=PilotRuns.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    });

}

export const dataAggregationController = new DataAggregationController();
