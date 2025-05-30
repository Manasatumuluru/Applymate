import express from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { generateAIResponse } from '../config/openrouter';
import Application from '../models/application.model';
import applicationQueue from '../queues/application.queue';
import mammoth from "mammoth";
import fs from "fs";

const router = express.Router();
const upload = multer(); 


router.post('/analyze', upload.single('resume'), async (req, res) => {
  try {
    const jobDescription = req.body.jobDescription;
    const fileBuffer = req.file?.buffer;
    const mimeType = req.file?.mimetype;

    if (!jobDescription || !fileBuffer || !mimeType) {
      return res.status(400).json({ message: 'Missing resume file or job description' });
    }

    let resumeText = '';

    if (mimeType === 'application/pdf') {
      const parsed = await pdfParse(fileBuffer);
      resumeText = parsed.text;
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    ) {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      resumeText = result.value;
    } else {
      return res.status(400).json({ message: 'Unsupported file format. Please upload PDF or Word.' });
    }

    const app = new Application({ resumeText, jobDescription });
    await app.save();

    await applicationQueue.add('analyze', { applicationId: app._id }, {
    attempts: 3, // retry up to 3 times on failure
    backoff: {
    type: 'exponential', // could also use 'fixed'
    delay: 3000, // wait 3 seconds before retrying
  },
});
console.log("📥 Job added to queue with ID:", app._id);
    res.json({ id: app._id, status: 'queued' });

  } catch (error) {
    console.error('❌ Resume parse or DB error:', error);
    res.status(500).json({ message: 'Resume upload or processing failed' });
  }
});

router.get('/results/:id', async (req, res) => {
  const { id } = req.params;
  const app = await Application.findById(id);
  if (!app) return res.status(404).json({ message: 'Not found' });
  res.json(app);
});


router.post('/cover-letter/:id', async (req, res) => {
  const { id } = req.params;
  const app = await Application.findById(id);
  if (!app) return res.status(404).json({ message: 'Application not found' });

  if (app.coverLetterStatus === 'done') {
    return res.status(200).json({ message: 'Already generated', coverLetter: app.coverLetter });
  }

  app.coverLetterStatus = 'pending';
  await app.save();

  const trimmedResume = app.resumeText.slice(0, 3000);
  const trimmedJD = app.jobDescription.slice(0, 2000);

  const prompt = `
Write a concise, professional cover letter in under 200 words.

Context:
Resume:
${trimmedResume}

Job Description:
${trimmedJD}

Focus on alignment, skills, and impact. Output only the cover letter, no explanations.
`;

  const result = await generateAIResponse(prompt, 'mistralai/mistral-7b-instruct');

  app.coverLetter = result.coverLetter || '';
  app.coverLetterStatus = 'done';
  await app.save();

  res.status(200).json({ message: 'Cover letter generated', coverLetter: result.coverLetter });
});

export default router;
