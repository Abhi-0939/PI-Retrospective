/**
 * ai-engine.js — Local AI suggestion engine for PI Retrospectives
 * PI Retrospective App — SAFe 6.0
 *
 * This module provides:
 *  1. analyzeRetrospective(retro) — returns structured suggestions
 *  2. generateCopilotPrompt(retro, history) — builds a rich GitHub Copilot prompt
 *  3. detectThemes(items) — clusters retrospective items by theme
 *
 * No external API calls are made by this module.
 * The Copilot Prompt feature generates a prompt you can paste into GitHub Copilot Chat / Copilot Workspace.
 */

'use strict';

/* ─── Theme Keyword Maps ─────────────────────────────────────── */
const THEMES = {
  process: {
    label: 'Process & Workflow',
    icon: '⚙️',
    keywords: ['process', 'workflow', 'sprint', 'iteration', 'ceremony', 'meeting', 'planning', 'retrospective',
                'review', 'refinement', 'backlog', 'standup', 'scrum', 'kanban', 'wip', 'flow', 'velocity',
                'throughput', 'cycle time', 'lead time', 'cadence', 'definition of done', 'done', 'acceptance']
  },
  communication: {
    label: 'Communication & Collaboration',
    icon: '💬',
    keywords: ['communication', 'collaborate', 'team', 'feedback', 'alignment', 'sync', 'unclear',
                'misunderstanding', 'information', 'share', 'transparency', 'visibility', 'update',
                'notify', 'inform', 'discussion', 'decision', 'stakeholder', 'cross-team', 'coordination']
  },
  technical: {
    label: 'Technical Practices',
    icon: '🔧',
    keywords: ['code', 'test', 'review', 'debt', 'bug', 'defect', 'quality', 'coverage', 'ci', 'cd',
                'pipeline', 'deploy', 'release', 'build', 'refactor', 'architecture', 'design',
                'technical', 'automation', 'security', 'performance', 'scalability', 'api', 'integration']
  },
  dependency: {
    label: 'Dependencies & Blockers',
    icon: '🔗',
    keywords: ['dependency', 'blocker', 'blocked', 'waiting', 'delay', 'external', 'third-party',
                'vendor', 'upstream', 'downstream', 'integration', 'interface', 'handoff', 'handover',
                'art', 'release train', 'team dependency', 'impediment', 'remove impediment']
  },
  people: {
    label: 'People & Culture',
    icon: '👥',
    keywords: ['morale', 'culture', 'engagement', 'motivation', 'recognition', 'celebrate', 'burnout',
                'workload', 'capacity', 'onboard', 'training', 'skills', 'knowledge', 'growth',
                'psychological safety', 'trust', 'respect', 'diversity', 'inclusion', 'people']
  },
  tooling: {
    label: 'Tools & Infrastructure',
    icon: '🛠️',
    keywords: ['tool', 'jira', 'confluence', 'polarion', 'azure devops', 'github', 'gitlab', 'jenkins',
                'infrastructure', 'environment', 'setup', 'configuration', 'license', 'access', 'permission',
                'ide', 'editor', 'keyboard', 'monitor', 'hardware', 'software', 'platform']
  },
  planning: {
    label: 'PI Planning & Objectives',
    icon: '🗓️',
    keywords: ['planning', 'pi objective', 'objective', 'goal', 'milestone', 'roadmap', 'forecast',
                'estimate', 'capacity', 'allocation', 'prioritize', 'priority', 'backlog', 'feature',
                'story', 'epic', 'program', 'art', 'rte', 'product manager', 'product owner']
  },
  delivery: {
    label: 'Delivery & Value',
    icon: '🚀',
    keywords: ['delivery', 'value', 'customer', 'business', 'feature', 'demo', 'showcase', 'release',
                'ship', 'mvp', 'milestone', 'increment', 'predictability', 'committed', 'achieved',
                'acceptance', 'stakeholder', 'feedback', 'satisfaction', 'nps']
  }
};

/* ─── SAFe-Aligned Action Item Templates ─────────────────────── */
const ACTION_TEMPLATES = {
  process: [
    { title: 'Conduct a Process Workshop', description: 'Facilitate a team workshop to map and improve the identified process bottlenecks. Define clear Definition of Done criteria and visualize the value stream.', priority: 'high' },
    { title: 'Establish Team Working Agreements', description: 'Define or update team working agreements covering meeting norms, communication channels, and escalation paths.', priority: 'medium' },
    { title: 'Optimize Agile Ceremony Structure', description: 'Review and streamline PI event agendas. Timeboxes and agendas should be reviewed with the RTE for alignment with SAFe practices.', priority: 'medium' }
  ],
  communication: [
    { title: 'Implement Structured Communication Channels', description: 'Establish clear communication channels per audience (team, ART, stakeholder). Define escalation paths and SLAs for responses.', priority: 'high' },
    { title: 'Create Cross-Team Sync Ritual', description: 'Introduce a bi-weekly cross-team sync to address dependencies and share progress. Include stakeholders as needed.', priority: 'medium' },
    { title: 'Improve Transparency with Visual Management', description: 'Set up a shared ART board (physical or digital) showing PI progress, dependencies, and risks visible to all teams.', priority: 'medium' }
  ],
  technical: [
    { title: 'Technical Debt Reduction Sprint', description: 'Allocate a dedicated portion (20%) of each sprint to address identified technical debt items. Create a technical debt backlog.', priority: 'high' },
    { title: 'Improve Test Automation Coverage', description: 'Set a coverage target (e.g. +15%) and define a plan to reach it within the next PI. Include unit, integration, and end-to-end tests.', priority: 'high' },
    { title: 'CI/CD Pipeline Enhancement', description: 'Review pipeline bottlenecks and implement caching, parallel execution, or additional automation to improve build times and reliability.', priority: 'medium' }
  ],
  dependency: [
    { title: 'Dependency Management Workshop', description: 'Facilitate a dependency identification session using the ART Dependency Board. Classify, assign owners, and track all cross-team dependencies.', priority: 'critical' },
    { title: 'Establish Dependency SLAs', description: 'Negotiate and document clear SLAs between teams for dependency resolution. Escalation path to RTE if SLAs are breached.', priority: 'high' },
    { title: 'Early Dependency Flagging in PI Planning', description: 'Update PI Planning process to include a dedicated dependency review session in Day 1 and Day 2. Use structured Program Board.', priority: 'medium' }
  ],
  people: [
    { title: 'Team Health Check and Action Plan', description: 'Run a Spotify Squad Health Check or similar tool. Use results to create a targeted improvement backlog for the next PI.', priority: 'high' },
    { title: 'Recognition and Celebration Practice', description: 'Introduce a lightweight recognition practice (e.g., kudos wall, shout-outs in team meetings) to boost morale and acknowledge contributions.', priority: 'low' },
    { title: 'Skills Development and Training Plan', description: 'Identify skill gaps from retrospective insights and create a learning plan. Include budget, time allocation, and success metrics.', priority: 'medium' }
  ],
  tooling: [
    { title: 'Toolchain Audit and Optimization', description: 'Audit all tools used by the team. Remove redundant tools, address licensing issues, and standardize on a lean toolset.', priority: 'medium' },
    { title: 'Developer Environment Setup Automation', description: 'Create automated environment setup scripts (e.g., Docker Compose, setup.sh) to eliminate "works on my machine" issues.', priority: 'high' },
    { title: 'Tool Training Sessions', description: 'Schedule short training sessions for tools where knowledge gaps were identified during the PI.', priority: 'low' }
  ],
  planning: [
    { title: 'Enhance PI Planning Preparation', description: 'Improve Feature/Story readiness criteria. Ensure the top-priority features are fully refined (INVESTED) before PI Planning Day 1.', priority: 'high' },
    { title: 'PI Objectives Review and Calibration', description: 'Review the business value assigned to PI objectives after the PI. Align with Product Management on objective quality criteria for next PI.', priority: 'medium' },
    { title: 'Capacity and Allocation Modeling', description: 'Build a capacity model that accounts for leave, ceremonies, innovation, and infrastructure work. Use this in PI Planning.', priority: 'medium' }
  ],
  delivery: [
    { title: 'Improve Demo Quality and Feedback Loop', description: 'Enhance PI System Demo preparation. Include real customer/end-user participation. Capture structured feedback for the next PI.', priority: 'high' },
    { title: 'Predictability Improvement Plan', description: 'Analyze the gap between committed and completed PI objectives. Identify root causes and create a plan to achieve 80%+ predictability.', priority: 'high' },
    { title: 'Customer Value Stream Mapping', description: 'Map the end-to-end value delivery stream to identify delays and waste. Share results with Product Management for backlog prioritization.', priority: 'medium' }
  ]
};

/* ─── AI Engine ──────────────────────────────────────────────── */
const AIEngine = {

  /**
   * Main analysis function.
   * @param {Object} retro - current retrospective object
   * @param {Array}  history - array of historical retrospectives from Store.loadHistory()
   * @returns {Array} array of suggestion objects
   */
  analyzeRetrospective(retro, history = []) {
    const suggestions = [];

    // Collect all negative and improvement items
    const improvementItems = retro.board.couldImprove || [];
    const negativeItems    = retro.board.didntGoWell || [];
    const allConcerns      = [...improvementItems, ...negativeItems];

    if (allConcerns.length === 0) {
      return this._generateGenericSuggestions(retro);
    }

    // Detect themes from the concerns
    const themeCounts = this._detectThemes(allConcerns);

    // Build suggestions from themes (top 5)
    const topThemes = Object.entries(themeCounts)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5);

    const usedTitles = new Set();

    for (const [themeKey, themeData] of topThemes) {
      if (themeData.count === 0) continue;
      const templates = ACTION_TEMPLATES[themeKey] || [];
      if (templates.length === 0) continue;

      // Pick first template not already used
      for (const template of templates) {
        if (!usedTitles.has(template.title)) {
          usedTitles.add(template.title);

          suggestions.push({
            id: UUID.v4(),
            title: template.title,
            description: template.description,
            priority: template.priority,
            category: THEMES[themeKey]?.label || themeKey,
            categoryIcon: THEMES[themeKey]?.icon || '📌',
            rationale: this._buildRationale(themeKey, themeData.matchedItems, history),
            themeKey,
            isRecurring: this._isRecurring(themeKey, history),
            source: 'ai'
          });
          break;
        }
      }
    }

    // If context has missed milestones, add a specific suggestion
    const missedMilestones = (retro.piContext?.milestones || []).filter(m => m.status === 'missed');
    if (missedMilestones.length > 0 && !usedTitles.has('PI Objectives Review and Calibration')) {
      suggestions.push({
        id: UUID.v4(),
        title: 'Root Cause Analysis for Missed Milestones',
        description: `${missedMilestones.length} milestone(s) were missed this PI. Conduct a structured Root Cause Analysis (5-Why or fishbone) and incorporate preventive actions into the next PI Planning.`,
        priority: 'high',
        category: 'PI Planning & Objectives',
        categoryIcon: '🗓️',
        rationale: `${missedMilestones.length} milestone(s) marked as missed during this PI.`,
        isRecurring: false,
        source: 'ai'
      });
    }

    // Add a team health check if not many "went well" items
    if ((retro.board.wentWell || []).length < (allConcerns.length / 3)) {
      suggestions.push({
        id: UUID.v4(),
        title: 'Team Wellbeing and Morale Assessment',
        description: 'The ratio of concerns to positives suggests team morale may need attention. Administer a Team Health Check and create a targeted wellbeing improvement plan.',
        priority: 'high',
        category: 'People & Culture',
        categoryIcon: '👥',
        rationale: 'Fewer "went well" items relative to concerns may indicate team stress or morale issues.',
        isRecurring: false,
        source: 'ai'
      });
    }

    return suggestions.slice(0, 8); // Cap at 8 suggestions
  },

  /**
   * Detects thematic distribution across retrospective items.
   */
  _detectThemes(items) {
    const counts = {};
    for (const key of Object.keys(THEMES)) {
      counts[key] = { count: 0, matchedItems: [] };
    }

    for (const item of items) {
      const text = (item.text || '').toLowerCase();
      for (const [key, theme] of Object.entries(THEMES)) {
        for (const kw of theme.keywords) {
          if (text.includes(kw)) {
            counts[key].count++;
            if (!counts[key].matchedItems.some(i => i.id === item.id)) {
              counts[key].matchedItems.push(item);
            }
            break; // count each item once per theme
          }
        }
      }
    }
    return counts;
  },

  /**
   * Builds a human-readable rationale from matched items.
   */
  _buildRationale(themeKey, matchedItems, history) {
    const theme = THEMES[themeKey];
    const label = theme?.label || themeKey;
    const count = matchedItems.length;

    const isRecurring = this._isRecurring(themeKey, history);
    const recurSuffix = isRecurring
      ? ` This theme has appeared in previous retrospectives — making it a recurring concern.`
      : '';

    if (count === 1) {
      return `1 retrospective item relates to ${label}.${recurSuffix}`;
    }
    return `${count} retrospective items relate to ${label}, including: "${(matchedItems[0]?.text || '').slice(0, 60)}...".${recurSuffix}`;
  },

  /**
   * Checks if a theme appeared in historical retrospectives.
   */
  _isRecurring(themeKey, history) {
    if (!history || history.length === 0) return false;
    const theme = THEMES[themeKey];
    if (!theme) return false;

    for (const pastRetro of history.slice(0, 5)) { // check last 5
      const allItems = [
        ...(pastRetro.board?.wentWell     || []),
        ...(pastRetro.board?.couldImprove || []),
        ...(pastRetro.board?.didntGoWell  || [])
      ];
      for (const item of allItems) {
        const text = (item.text || '').toLowerCase();
        if (theme.keywords.some(kw => text.includes(kw))) {
          return true;
        }
      }
    }
    return false;
  },

  /**
   * Generic suggestions when no board data exists yet.
   */
  _generateGenericSuggestions(retro) {
    return [
      {
        id: UUID.v4(),
        title: 'Establish Continuous Improvement Cadence',
        description: 'Ensure every PI planning includes a review of previous retrospective action items. Track completion rates across PIs to improve retrospective effectiveness.',
        priority: 'medium',
        category: 'Process & Workflow',
        categoryIcon: '⚙️',
        rationale: 'SAFe 6.0 Pillar: Relentless Improvement — systematic cadence needed.',
        isRecurring: false,
        source: 'ai'
      },
      {
        id: UUID.v4(),
        title: 'Create ART Inspect &amp; Adapt Action Backlog',
        description: 'Maintain a dedicated backlog for I&amp;A improvements. Assign owners, priorities, and track progress transparently across all teams on the ART.',
        priority: 'high',
        category: 'PI Planning & Objectives',
        categoryIcon: '🗓️',
        rationale: 'Best practice: Inspect &amp; Adapt outcomes should drive explicit backlog items.',
        isRecurring: false,
        source: 'ai'
      }
    ];
  },

  /**
   * Generates a detailed GitHub Copilot prompt that users can copy and paste
   * into GitHub Copilot Chat for deeper AI-driven analysis.
   *
   * @param {Object} retro   - current retrospective
   * @param {Array}  history - list of historical retrospectives
   * @returns {string} formatted prompt text
   */
  generateCopilotPrompt(retro, history = []) {
    const boardItems = (col, label) =>
      (retro.board[col] || []).map((n, i) => `  ${i + 1}. ${n.text}`).join('\n') || '  (none)';

    const historyContext = history.length > 0
      ? history.slice(0, 3).map(h => {
          const actions = (h.actionItems || []).map(a => `    - [${a.status}] ${a.title}`).join('\n') || '    (none)';
          return `- ${h.piName} (${h.createdAt?.split('T')[0] || '?'}):\n  Actions:\n${actions}`;
        }).join('\n')
      : '  No historical data available.';

    const events = (retro.piContext?.events || []).map(e => `  - ${e.text} (${e.date || 'date unset'})`).join('\n') || '  (none)';
    const milestones = (retro.piContext?.milestones || [])
      .map(m => `  - [${m.status.toUpperCase()}] ${m.text}`).join('\n') || '  (none)';

    return `# PI Retrospective Analysis Request

## Context
You are acting as an Agile Coach with deep expertise in SAFe 6.0 (Scaled Agile Framework).
Analyze the following PI Retrospective data and provide:
1. A holistic assessment of team health and delivery performance
2. Top 5 prioritized, SMART action items with specific owners (roles, not names)
3. Patterns or anti-patterns from the historical data
4. Specific SAFe practices to adopt or strengthen based on the findings
5. Risks that should be escalated to the RTE or Business Owner

---
## Current PI: ${retro.piName}
- **ART:** ${retro.artName || 'Not specified'}
- **Duration:** ${retro.startDate || '?'} to ${retro.endDate || '?'}
- **Participants:** ${(retro.participants?.length || 0) + 1}

## PI Objectives
${retro.piObjectives || '(not specified)'}

## PI Events & Milestones
### Important Events:
${events}
### Milestones:
${milestones}

---
## Retrospective Board

### ✅ What Went Well:
${boardItems('wentWell', 'Went Well')}

### ⬆️ What Could Be Improved:
${boardItems('couldImprove', 'Could Improve')}

### ❌ What Didn't Go Well:
${boardItems('didntGoWell', 'Didn\'t Go Well')}

---
## Existing Action Items (${retro.actionItems?.length || 0} total)
${(retro.actionItems || []).map(a =>
  `- [${a.priority.toUpperCase()}] [${a.status}] ${a.title}`
).join('\n') || '  (none defined yet)'}

---
## Historical Retrospective Data (Last ${Math.min(history.length, 3)} PIs)
${historyContext}

---
## Your Analysis

Please structure your response as follows:
1. **Key Observations** (3-5 bullets)
2. **Recurring Themes** (compare with historical data)
3. **Prioritized Action Items** (SMART format, 5 items max)
4. **SAFe Practice Recommendations** (specific to SAFe 6.0)
5. **Risks & Escalations** (items requiring RTE/Business Owner attention)
`;
  }
};
