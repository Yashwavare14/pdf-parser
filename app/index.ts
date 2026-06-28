import express, { Request, Response } from 'express';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON bodies
app.use(express.json());

// 1. Define your schemas (Same as before)
const mcqQuestionSchema: Schema = {
    type: Type.OBJECT,
    properties: {
        question_number: { type: Type.STRING, description: "e.g., 'Q1' or 'Q77'" },
        question_text: { type: Type.STRING, description: "The complete question body text." },
        options: {
            type: Type.OBJECT,
            properties: {
                a: { type: Type.STRING },
                b: { type: Type.STRING },
                c: { type: Type.STRING },
                d: { type: Type.STRING }
            },
            required: ["a", "b", "c", "d"]
        },
        answer_key: { type: Type.STRING, nullable: true },
        explanation: { type: Type.STRING, nullable: true }
    },
    required: ["question_number", "question_text", "options"]
};

const examPaperSchema: Schema = {
    type: Type.OBJECT,
    properties: {
        paper_title: { type: Type.STRING, description: "The title of the exam paper." },
        questions: { type: Type.ARRAY, items: mcqQuestionSchema }
    },
    required: ["paper_title", "questions"]
};

app.post('/api/extract', async (req: Request, res: Response): Promise<void> => {
    const { pdfFileName } = req.body;

    if (!pdfFileName) {
        res.status(400).json({ error: "Missing 'pdfFileName' in request body." });
        return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
        return;
    }

    const ai = new GoogleGenAI({ apiKey });
    const resolvedPath = path.resolve(pdfFileName);

    if (!fs.existsSync(resolvedPath)) {
        res.status(404).json({ error: `Could not find file at ${pdfFileName}` });
        return;
    }

    let uploadedFileMeta: any = null;

    try {
        console.log(`📦 Uploading ${pdfFileName} to Gemini File API...`);
        uploadedFileMeta = await ai.files.upload({
            file: resolvedPath,
            mimeType: 'application/pdf'
        });

        const engineeringPrompt = `
            You are an advanced document parsing intelligence. Carefully examine the attached PDF and extract all the multiple-choice questions into the requested schema structure. Do not include watermarks or background headers.
        `;

        console.log("🤖 Querying Gemini model...");
        const runtimeResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [uploadedFileMeta, engineeringPrompt],
            config: {
                responseMimeType: 'application/json',
                responseSchema: examPaperSchema,
                temperature: 0.1
            }
        });

        if (runtimeResponse.text) {
            const parsedData = JSON.parse(runtimeResponse.text);
            res.status(200).json({
                success: true,
                data: parsedData
            });
        } else {
            res.status(500).json({ error: "Model returned an empty response." });
        }

    } catch (error: any) {
        console.error("❌ Pipeline Error:", error);
        res.status(500).json({ error: error.message || "An error occurred during extraction." });
    } finally {
        if (uploadedFileMeta) {
            console.log("🗑️ Cleaning up storage file...");
            await ai.files.delete({ name: uploadedFileMeta.name });
        }
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Express server running live at http://localhost:${PORT}`);
    console.log(`📡 Endpoint ready: POST http://localhost:${PORT}/api/extract`);
});
