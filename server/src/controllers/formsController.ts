import { Request, Response } from 'express';
import { formsService } from '../services/forms.service';
import { requestHandler } from '../utils/requestHandler';

const getOwnerId = (req: Request): string | undefined =>
    req.user?.role === 'admin' ? undefined : req.user?._id;

class FormsController {
    getForms = requestHandler(async (req: Request, res: Response) => {
        const forms = await formsService.getAllForms(getOwnerId(req));
        res.status(200).send(forms);
    });

    getForm = requestHandler(async (req: Request, res: Response) => {
        const formId = req.params.id;
        const forms = await formsService.getForm(formId);
        res.status(200).send(forms);
    });

    saveForm = requestHandler(async (req: Request, res: Response) => {
        const { form } = req.body;
        const savedForm = await formsService.saveForm(form, req.user._id);
        const { _id, name } = savedForm;

        res.status(200).send({ _id, name });
    });

    updateForm = requestHandler(async (req: Request, res: Response) => {
        const { form } = req.body;
        const response = await formsService.updateForms(form, getOwnerId(req));
        res.status(200).send(response);
    });

    deleteForm = requestHandler(async (req: Request, res: Response) => {
        const formId = req.params.id;
        const response = await formsService.deleteForm(formId, getOwnerId(req));
        res.status(200).send(response);
    });
}

export const formsController = new FormsController();
