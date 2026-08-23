/**
 * performance-ai.js - AI-Powered Performance Analysis
 * Analyzes PageSpeed Insights data and generates expert recommendations
 */

import { getApiKey } from './auth.js';
import { getUserDoc } from './auth.js';

// ── SYSTEM PROMPT FOR AI ANALYSIS ────────────────────────────
const PERFORMANCE_ANALYST_PROMPT = `You are an expert Website Performance Engineer, Technical SEO Consultant, Core Web Vitals Specialist, and Frontend Optimization Expert.

Your job is to analyze Google Lighthouse/PageSpeed Insights performance data and provide clear, actionable, beginner-friendly, and developer-friendly recommendations.

The input will contain:
- Website URL
- Device Strategy (Mobile/Desktop)
- Lighthouse Scores
- Core Web Vitals
- Opportunities
- Diagnostics
- Passed Audits

Your task is NOT to simply repeat Lighthouse data.
Instead, deeply analyze the report and generate practical solutions.

For every issue:
1. Explain the issue in simple English.
2. Explain why this issue affects website performance, SEO, and user experience.
3. Explain the possible root cause.
4. Provide step-by-step instructions to fix it.
5. Mention exactly where developers should look (HTML, CSS, JavaScript, Images, Fonts, Server, Database, WordPress, OpenCart, React, etc.).
6. If applicable, generate optimized HTML, CSS, JavaScript, or server configuration examples.
7. Estimate:
   - Difficulty (Easy / Medium / Hard)
   - Time Required
   - Expected Performance Improvement
8. Prioritize all recommendations from highest impact to lowest impact.
9. Never recommend unnecessary optimizations that provide little benefit.
10. Explain every recommendation in beginner-friendly language.

Also generate:
• Executive Summary
• Critical Issues
• High Priority Fixes
• Medium Priority Fixes
• Low Priority Fixes
• Quick Wins (less than 30 minutes)
• Estimated Performance Score After Optimizations
• Final Performance Improvement Roadmap

Always return JSON only.
Do not return Markdown.
Do not return explanations outside JSON.

Return JSON in this exact structure:
{
  "executiveSummary": {
    "currentScore": 0,
    "projectedScore": 0,
    "keyIssues": ["issue1", "issue2"],
    "estimatedTimeToFix": "X hours",
    "priorityLevel": "Critical/High/Medium/Low"
  },
  "criticalIssues": [
    {
      "title": "Issue title",
      "description": "Simple explanation",
      "impact": "Why it matters",
      "rootCause": "What causes this",
      "solution": "How to fix",
      "codeExample": "Code if applicable",
      "difficulty": "Easy/Medium/Hard",
      "timeRequired": "30 minutes",
      "expectedImprovement": "+10 points",
      "priority": 1,
      "affectedMetrics": ["LCP", "FCP"]
    }
  ],
  "highPriorityFixes": [],
  "mediumPriorityFixes": [],
  "lowPriorityFixes": [],
  "quickWins": [],
  "performanceRoadmap": {
    "phase1": {
      "title": "Immediate fixes",
      "duration": "1-2 days",
      "tasks": []
    },
    "phase2": {
      "title": "Short term",
      "duration": "1 week",
      "tasks": []
    },
    "phase3": {
      "title": "Long term",
      "duration": "2-4 weeks",
      "tasks": []
    }
  }
}`;

// ── ANALYZE PERFORMANCE DATA WITH AI ──────────────────────────
export async function analyzePerformanceWithAI(auditData) {
  const userDoc = getUserDoc();
  const provider = userDoc?.defaultProvider || 'groq';
  
  // Prepare the input data for AI
  const analysisInput = {
    url: auditData.url,
    strategy: auditData.strategy,
    scores: auditData.scores,
    coreWebVitals: _formatCoreWebVitals(auditData.coreWebVitals),
    opportunities: _formatOpportunities(auditData.opportunities),
    diagnostics: _formatDiagnostics(auditData.diagnostics),
    passedAudits: auditData.passed.length
  };
  
  const userMessage = `Analyze this PageSpeed Insights report and provide expert recommendations:

${JSON.stringify(analysisInput, null, 2)}`;

  try {
    let analysis;
    
    if (provider === 'groq') {
      analysis = await _analyzeWithGroq(userMessage);
    } else if (provider === 'gemini') {
      analysis = await _analyzeWithGemini(userMessage);
    } else if (provider === 'openrouter') {
      analysis = await _analyzeWithOpenRouter(userMessage);
    } else {
      throw new Error('Invalid AI provider configured.');
    }
    
    return analysis;
  } catch (error) {
    console.error('[PerformanceAI] Analysis error:', error);
    throw new Error('Failed to analyze performance data: ' + error.message);
  }
}

// ── FORMAT CORE WEB VITALS ────────────────────────────────────
function _formatCoreWebVitals(cwv) {
  return Object.entries(cwv).map(([key, metric]) => ({
    name: metric.title,
    value: metric.displayValue,
    score: metric.score,
    status: metric.score >= 0.9 ? 'good' : metric.score >= 0.5 ? 'needs-improvement' : 'poor'
  }));
}

// ── FORMAT OPPORTUNITIES ───────────────────────────────────────
function _formatOpportunities(opportunities) {
  return opportunities.map(opp => ({
    title: opp.title,
    description: opp.description,
    savings: opp.displayValue || 'Unknown'
  }));
}

// ── FORMAT DIAGNOSTICS ─────────────────────────────────────────
function _formatDiagnostics(diagnostics) {
  return diagnostics.map(diag => ({
    title: diag.title,
    description: diag.description,
    value: diag.displayValue || 'N/A'
  }));
}

// ── GROQ AI ANALYSIS ───────────────────────────────────────────
async function _analyzeWithGroq(userMessage) {
  const apiKey = getApiKey('groq');
  if (!apiKey) throw new Error('Groq API key not configured.');
  
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: PERFORMANCE_ANALYST_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Groq API request failed.');
  }
  
  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  
  if (!content) throw new Error('No response from Groq API.');
  
  return JSON.parse(content);
}

// ── GEMINI AI ANALYSIS ─────────────────────────────────────────
async function _analyzeWithGemini(userMessage) {
  const apiKey = getApiKey('gemini');
  if (!apiKey) throw new Error('Gemini API key not configured.');
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: PERFORMANCE_ANALYST_PROMPT + '\n\n' + userMessage
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4000,
          responseMimeType: 'application/json'
        }
      })
    }
  );
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Gemini API request failed.');
  }
  
  const data = await response.json();
  const content = data.candidates[0]?.content?.parts[0]?.text;
  
  if (!content) throw new Error('No response from Gemini API.');
  
  return JSON.parse(content);
}

// ── OPENROUTER AI ANALYSIS ─────────────────────────────────────
async function _analyzeWithOpenRouter(userMessage) {
  const apiKey = getApiKey('openrouter');
  if (!apiKey) throw new Error('OpenRouter API key not configured.');
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Abra Zylo SEO Portal'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.0-flash-exp:free',
      messages: [
        { role: 'system', content: PERFORMANCE_ANALYST_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenRouter API request failed.');
  }
  
  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  
  if (!content) throw new Error('No response from OpenRouter API.');
  
  return JSON.parse(content);
}

// ── GENERATE FALLBACK ANALYSIS (NO AI) ────────────────────────
export function generateFallbackAnalysis(auditData) {
  const { scores, coreWebVitals, opportunities, diagnostics } = auditData;
  
  // Calculate priority based on scores
  const avgScore = (scores.performance + scores.accessibility + scores.bestPractices + scores.seo) / 4;
  const priorityLevel = avgScore < 50 ? 'Critical' : avgScore < 70 ? 'High' : avgScore < 85 ? 'Medium' : 'Low';
  
  // Identify critical issues
  const criticalIssues = [];
  
  if (scores.performance < 50) {
    criticalIssues.push({
      title: 'Poor Performance Score',
      description: 'Your website is loading too slowly, which hurts user experience and SEO rankings.',
      impact: 'Users will leave before your page loads. Google may rank your site lower.',
      rootCause: 'Large images, unoptimized code, or slow server response times.',
      solution: 'Focus on the top opportunities listed in the PageSpeed report.',
      difficulty: 'Medium',
      timeRequired: '2-4 hours',
      expectedImprovement: '+20-30 points',
      priority: 1,
      affectedMetrics: ['Performance Score', 'LCP', 'FCP']
    });
  }
  
  // Check Core Web Vitals
  if (coreWebVitals.lcp.score < 0.5) {
    criticalIssues.push({
      title: 'Slow Largest Contentful Paint (LCP)',
      description: 'The main content of your page takes too long to load.',
      impact: 'Poor user experience. Google uses LCP as a ranking factor.',
      rootCause: 'Large images, slow server response, or render-blocking resources.',
      solution: 'Optimize images, use CDN, preload critical resources, improve server response time.',
      difficulty: 'Medium',
      timeRequired: '1-2 hours',
      expectedImprovement: '+15 points',
      priority: 2,
      affectedMetrics: ['LCP']
    });
  }
  
  if (coreWebVitals.cls.score < 0.5) {
    criticalIssues.push({
      title: 'High Cumulative Layout Shift (CLS)',
      description: 'Your page elements are moving around as the page loads.',
      impact: 'Frustrating user experience. Users may click the wrong buttons.',
      rootCause: 'Images without dimensions, dynamic content insertion, or web fonts loading.',
      solution: 'Set width and height on images and embeds. Reserve space for dynamic content.',
      difficulty: 'Easy',
      timeRequired: '30 minutes - 1 hour',
      expectedImprovement: '+10 points',
      priority: 3,
      affectedMetrics: ['CLS']
    });
  }
  
  // Convert opportunities to high priority fixes
  const highPriorityFixes = opportunities.slice(0, 3).map((opp, idx) => ({
    title: opp.title,
    description: opp.description,
    impact: 'Implementing this will improve page load speed.',
    solution: 'Follow Google PageSpeed recommendations for this specific optimization.',
    difficulty: 'Medium',
    timeRequired: '1-2 hours',
    expectedImprovement: opp.displayValue || 'Varies',
    priority: idx + 4
  }));
  
  // Quick wins
  const quickWins = [];
  if (opportunities.some(o => o.id === 'unminified-css')) {
    quickWins.push({
      title: 'Minify CSS',
      description: 'Remove unnecessary characters from your CSS files.',
      solution: 'Use online tools or build tools to minify CSS automatically.',
      difficulty: 'Easy',
      timeRequired: '15 minutes',
      expectedImprovement: '+2-5 points'
    });
  }
  
  if (opportunities.some(o => o.id === 'unminified-javascript')) {
    quickWins.push({
      title: 'Minify JavaScript',
      description: 'Remove unnecessary characters from your JavaScript files.',
      solution: 'Use online tools or build tools to minify JavaScript automatically.',
      difficulty: 'Easy',
      timeRequired: '15 minutes',
      expectedImprovement: '+2-5 points'
    });
  }
  
  return {
    executiveSummary: {
      currentScore: scores.performance,
      projectedScore: Math.min(100, scores.performance + 20),
      keyIssues: criticalIssues.map(i => i.title).slice(0, 3),
      estimatedTimeToFix: '4-8 hours',
      priorityLevel
    },
    criticalIssues,
    highPriorityFixes,
    mediumPriorityFixes: [],
    lowPriorityFixes: [],
    quickWins,
    performanceRoadmap: {
      phase1: {
        title: 'Immediate Fixes (Week 1)',
        duration: '1-3 days',
        tasks: criticalIssues.map(i => i.title)
      },
      phase2: {
        title: 'High Priority Optimizations (Week 2-3)',
        duration: '1-2 weeks',
        tasks: highPriorityFixes.map(f => f.title)
      },
      phase3: {
        title: 'Long-term Improvements (Month 1-2)',
        duration: '2-4 weeks',
        tasks: ['Implement monitoring', 'Regular performance audits', 'Continuous optimization']
      }
    }
  };
}
