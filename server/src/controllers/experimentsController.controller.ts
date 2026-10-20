import { Request, Response } from 'express';
import { conversationsService } from '../services/conversations.service';
import { experimentsService } from '../services/experiments.service';
import { formsService } from '../services/forms.service';
import { usersService } from '../services/users.service';
import { requestHandler } from '../utils/requestHandler';

const getOwnerId = (req: Request): string | undefined =>
    req.user?.role === 'admin' ? undefined : req.user?._id;

class ExperimentsController {
    getExperiments = requestHandler(async (req: Request, res: Response) => {
        const experiments = await experimentsService.getExperiments(getOwnerId(req));
        res.status(200).send(experiments);
    });

    // Public (no auth), so it must not reveal the study design. An allowlist, so new schema
    // fields stay hidden by default; it returns only what other public routes already expose.
    // Title and description are left out: a title can name the manipulation.
    // Unused by the current client, kept so an older open tab doesn't 404 mid-study.
    // Projected here because other callers of getExperiment need the full document.
    getExperiment = requestHandler(async (req: Request, res: Response) => {
        const experimentId = req.params.id as string;
        const experiment = await experimentsService.getExperiment(experimentId);

        if (!experiment) {
            res.status(404).send({ error: 'Experiment not found' });
            return;
        }

        res.status(200).send({
            _id: experiment._id,
            isActive: experiment.isActive ?? false,
            displaySettings: experiment.displaySettings || {},
            experimentFeatures: experiment.experimentFeatures || {},
            experimentForms: experiment.experimentForms || {},
        });
    });

    getExperimentContent = requestHandler(async (req: Request, res: Response) => {
        const experimentId = req.params.id as string;
        const experiment = await experimentsService.getExperiment(experimentId);

        if (!experiment) {
            res.status(404).send({ error: 'Experiment not found' });
            return;
        }

        res.status(200).send({
            content: experiment.displaySettings || {},
            isActive: experiment.isActive ?? false
        });
    });

    createExperiment = requestHandler(async (req: Request, res: Response) => {
        const { experiment } = req.body;
        const savedExperiment = await experimentsService.createExperiment(experiment, req.user._id);
        res.status(200).send(savedExperiment);
    });

    updateExperimentsStatus = requestHandler(async (req: Request, res: Response) => {
        const { modifiedExperiments } = req.body;
        await experimentsService.updateExperimentsStatus(modifiedExperiments, getOwnerId(req));
        res.status(200).send();
    });

    updateExperimentDisplaySetting = requestHandler(async (req: Request, res: Response) => {
        const { experimentId, displaySettings } = req.body;
        await experimentsService.updateExperimentDisplaySettings(experimentId, displaySettings, getOwnerId(req));
        res.status(200).send();
    });

    updateExperiment = requestHandler(async (req: Request, res: Response) => {
        const { experiment } = req.body;
        await experimentsService.updateExperiment(experiment, getOwnerId(req));
        res.status(200).send();
    });

    getRegistrationForm = requestHandler(async (req: Request, res: Response) => {
        const experimentId = req.params.id as string;
        const experiment = await experimentsService.getExperiment(experimentId);

        if (!experiment) {
            res.status(404).send({ error: 'Experiment not found' });
            return;
        }

        if (experiment.experimentForms?.registration) {
            const form = await formsService.getForm(experiment.experimentForms.registration);
            res.status(200).send(form);
            return;
        }
        res.status(200).send(null);
    });

    getConversationForms = requestHandler(async (req: Request, res: Response) => {
        const experimentId = req.params.id as string;
        const experiment = await experimentsService.getExperiment(experimentId);

        if (!experiment) {
            res.status(404).send({ error: 'Experiment not found' });
            return;
        }

        const forms = await formsService.getConversationForms(
            experiment.experimentForms?.preConversation,
            experiment.experimentForms?.postConversation,
        );
        res.status(200).send(forms);
    });

    getAllExperimentsByAgentId = requestHandler(async (req: Request, res: Response) => {
        const { agentId } = req.query;
        const experiments = await experimentsService.getAllExperimentsByAgentId(agentId as string, getOwnerId(req));
        res.status(200).send(experiments);
    });

    getExperimentFeatures = requestHandler(async (req: Request, res: Response) => {
        const experimentId = req.params.id as string;
        const experimentFeatures = await experimentsService.getExperimentFeatures(experimentId);

        if (experimentFeatures === null) {
            res.status(404).send({ error: 'Experiment not found' });
            return;
        }

        res.status(200).send(experimentFeatures);
    });

    deleteExperiment = requestHandler(async (req: Request, res: Response) => {
        const experimentId = req.params.id as string;
        const ownerId = getOwnerId(req);

        // Verify ownership for non-admin users
        if (ownerId) {
            const experiment = await experimentsService.getExperiment(experimentId);
            if (!experiment || experiment.ownerId !== ownerId) {
                res.status(403).send({ error: 'Insufficient permissions' });
                return;
            }
        }

        await Promise.all([
            experimentsService.deleteExperiment(experimentId, ownerId),
            usersService.deleteExperimentUsers(experimentId),
            conversationsService.deleteExperimentConversations(experimentId),
        ]);

        res.status(200).send();
    });
}

export const experimentsController = new ExperimentsController();
