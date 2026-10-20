import { UpdateWriteOpResult } from 'mongoose';
import { IForm } from '../types';
import { FormsModel } from '../models/FormsModel';
import { SERVER_OWNED_FIELDS, stripServerOwned } from '../utils/serverOwnedFields';

interface DeleteResponse {
    acknowledged?: boolean;
    deletedCount?: number;
}
class FormsService {
    saveForm = async (form: IForm, ownerId: string): Promise<IForm> => {
        const response = await FormsModel.create({ ...form, ownerId });
        return response;
    };

    getAllForms = async (ownerId?: string): Promise<IForm[]> => {
        const filter = ownerId ? { ownerId } : {};
        const forms: IForm[] = await FormsModel.find(filter, { _id: 1, name: 1 });
        return forms;
    };

    getForm = async (formId: string): Promise<IForm> => {
        const form: IForm = await FormsModel.findOne({ _id: formId });
        return form;
    };

    getConversationForms = async (
        preConversationFormId: string,
        postConversationFormId: string,
    ): Promise<{ preConversation: IForm; postConversation: IForm }> => {
        const forms: IForm[] = await FormsModel.find({
            _id: { $in: [preConversationFormId, postConversationFormId] },
        });
        let preConversation, postConversation;
        forms.forEach((form) => {
            if (form._id.toString() === preConversationFormId) preConversation = form;
            if (form._id.toString() === postConversationFormId) postConversation = form;
        });

        return {
            preConversation,
            postConversation,
        };
    };

    updateForms = async (form: IForm, ownerId?: string): Promise<UpdateWriteOpResult> => {
        const filter: any = { _id: form._id };
        if (ownerId) filter.ownerId = ownerId;
        // Strip server-owned fields so a client body can't reassign ownerId and orphan the form.
        const update = stripServerOwned(form, SERVER_OWNED_FIELDS.form);
        const response: UpdateWriteOpResult = await FormsModel.updateOne(filter, { $set: update });
        return response;
    };

    deleteForm = async (formId: string, ownerId?: string): Promise<DeleteResponse> => {
        const filter: any = { _id: formId };
        if (ownerId) filter.ownerId = ownerId;
        const response: DeleteResponse = await FormsModel.deleteOne(filter);
        return response;
    };
}

export const formsService = new FormsService();
