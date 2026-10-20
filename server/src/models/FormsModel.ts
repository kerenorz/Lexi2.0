import { Schema } from 'mongoose';
import { mongoDbProvider } from '../mongoDBProvider';
import { IForm } from '../types';

export const formsScheme = new Schema<IForm>(
    {
        ownerId: { type: String, index: true },
        name: { type: String, required: true },
        title: { type: String },
        instructions: { type: String },
        questions: Array<{ type: { type: string; required: true }; props: { type: object } }>,
    },
    { versionKey: false },
);

export const FormsModel = mongoDbProvider.getModel('forms', formsScheme);
