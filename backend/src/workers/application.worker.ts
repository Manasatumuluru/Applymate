import dotenv from 'dotenv';
dotenv.config();

import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import connectDB from '../config/db';
import Application from '../models/application.model';
import { generateAIResponse } from '../config/openrouter';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

import http from 'http'; 

connectDB();

async function main() {
  const worker = new Worker(
  'application-processing',
  async job => {
    try {
      const { applicationId } = job.data;
      const app = await Application.findById(applicationId);
      if (!app) throw new Error('Application not found');

      app.status = 'processing';
      await app.save();

      const prompt = `${app.resumeText}<<<JD>>>${app.jobDescription}`;
      const result = await generateAIResponse(prompt);

      app.matchScore = result.matchScore;
      app.weakSkills = result.weakSkills;
      app.suggestedImprovements = result.suggestedImprovements;
      app.suggestedCourses = result.suggestedCourses;
      app.coverLetter = result.coverLetter;
      app.status = 'done';

      await app.save();
      console.log(`✅ Processed application ${applicationId}`);
      console.log("👀 Worker picked up job:", job.id, job.data);
    } catch (err) {
      console.error(`❌ Error processing job ${job.id}:`, err);
      throw err; // Important: rethrow to let BullMQ handle retries
    }
  },
  {
    connection,
    concurrency: 1,
      }
  );

  worker.on('failed', (job, err) => {
    console.error(`🔥 Final failure after retries for job ${job?.id}:`, err);
  });

  console.log('🔁 Worker is running...');
}

main().catch(err => {
  console.error('❌ Worker failed to start:', err);
});
//  Dummy HTTP listener to make Render happy
// http.createServer((_, res) => {
//   res.writeHead(200);
//   res.end('Worker running');
// }).listen(process.env.PORT || 3000); worker.ts

