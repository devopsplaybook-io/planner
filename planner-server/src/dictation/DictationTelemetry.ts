import {
  SpanStatusCode,
  type Attributes,
  type Counter,
  type Histogram,
  type Span,
} from "@opentelemetry/api";
import { StandardMeter, StandardTracer } from "@devopsplaybook.io/otel-utils";

/**
 * Telemetry for the dictation pipeline. Spans and metrics never carry audio
 * or transcript content: only ids, engine/model metadata, durations and
 * character counts. Every helper is inert when OpenTelemetry is not
 * configured (the StandardTracer/StandardMeter then use a no-op provider).
 */

export type DictationJobSource = "dictation" | "voice_comment" | "inline";

let tracer: StandardTracer | null = null;
let jobsCounter: Counter | null = null;
let jobsDuration: Histogram | null = null;
let stageDuration: Histogram | null = null;
let queueDuration: Histogram | null = null;
let errorsCounter: Counter | null = null;
let modelPrepareCounter: Counter | null = null;
let modelPrepareDuration: Histogram | null = null;
let noSpeechCounter: Counter | null = null;
let actionsProposedCounter: Counter | null = null;
let actionsResolutionCounter: Counter | null = null;
let actionsAppliedCounter: Counter | null = null;
let actionsUndoCounter: Counter | null = null;
let askCounter: Counter | null = null;

export function DictationTelemetryInit(
  tracerIn: StandardTracer,
  meterIn: StandardMeter,
): void {
  tracer = tracerIn;
  jobsCounter = meterIn.createCounter("dictation.jobs", {
    description: "Dictation and voice-comment jobs by source and final status",
  });
  jobsDuration = meterIn.createHistogram("dictation.job.duration", {
    description: "End-to-end dictation job duration",
    unit: "ms",
  });
  stageDuration = meterIn.createHistogram("dictation.stage.duration", {
    description: "Duration of each dictation pipeline stage",
    unit: "ms",
  });
  queueDuration = meterIn.createHistogram("dictation.queue.duration", {
    description: "Time a job waited before its STT stage started",
    unit: "ms",
  });
  errorsCounter = meterIn.createCounter("dictation.errors", {
    description: "Dictation stage failures by source and stage",
  });
  modelPrepareCounter = meterIn.createCounter(
    "stt.model.prepare",
    { description: "Embedded STT model preparation outcomes" },
  );
  modelPrepareDuration = meterIn.createHistogram(
    "stt.model.prepare.duration",
    { description: "Embedded STT model preparation duration", unit: "ms" },
  );
  noSpeechCounter = meterIn.createCounter("stt.no_speech", {
    description: "Recordings rejected because no speech was detected",
  });
  actionsProposedCounter = meterIn.createCounter("dictation.actions.proposed", {
    description: "Action proposals returned by the actions stage, by type",
  });
  actionsResolutionCounter = meterIn.createCounter(
    "dictation.actions.resolution",
    { description: "Action preview resolution outcomes, by type" },
  );
  actionsAppliedCounter = meterIn.createCounter("dictation.actions.applied", {
    description: "Action apply outcomes, by type",
  });
  actionsUndoCounter = meterIn.createCounter("dictation.actions.undo", {
    description: "Action undo outcomes, by type",
  });
  askCounter = meterIn.createCounter("dictation.ask", {
    description: "Read-only question outcomes, by intent",
  });
}

export interface DictationSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  fail(error: unknown): void;
  end(): void;
}

const NOOP_SPAN: DictationSpan = {
  setAttribute: () => undefined,
  fail: () => undefined,
  end: () => undefined,
};

/**
 * Starts a telemetry span. Returns a no-op handle when no tracer is
 * configured, so callers never need to branch.
 */
export function DictationTelemetryStartSpan(
  name: string,
  parentSpan?: Span,
  attributes?: Attributes,
): DictationSpan & { span: Span | null } {
  if (!tracer) {
    return { ...NOOP_SPAN, span: null };
  }
  let span: Span;
  try {
    span = tracer.startSpan(name, parentSpan, {
      kind: undefined,
    }) as unknown as Span;
  } catch {
    return { ...NOOP_SPAN, span: null };
  }
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        span.setAttribute(key, value as string | number | boolean);
      }
    }
  }
  return {
    span,
    setAttribute(key, value) {
      span.setAttribute(key, value);
    },
    fail(error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      try {
        span.recordException(error as Error);
      } catch {
        // Telemetry must never break the pipeline
      }
    },
    end() {
      span.end();
    },
  };
}

function safe<T>(fn: () => T): void {
  try {
    fn();
  } catch {
    // Telemetry must never break the pipeline
  }
}

export function DictationTelemetryRecordJob(
  source: DictationJobSource,
  status: string,
  durationMs: number,
): void {
  safe(() => {
    jobsCounter?.add(1, { source, status });
    jobsDuration?.record(durationMs, { source, status });
  });
}

export function DictationTelemetryRecordStage(
  stage: string,
  durationMs: number,
  source: DictationJobSource,
): void {
  safe(() => stageDuration?.record(durationMs, { stage, source }));
}

export function DictationTelemetryRecordQueue(
  durationMs: number,
  source: DictationJobSource,
): void {
  safe(() => queueDuration?.record(durationMs, { source }));
}

export function DictationTelemetryRecordError(
  source: DictationJobSource,
  stage: string,
): void {
  safe(() => errorsCounter?.add(1, { source, stage }));
}

export function DictationTelemetryRecordModelPrepare(
  model: string,
  durationMs: number,
  outcome: "ready" | "error",
): void {
  safe(() => {
    modelPrepareCounter?.add(1, { model, outcome });
    modelPrepareDuration?.record(durationMs, { model, outcome });
  });
}

export function DictationTelemetryRecordNoSpeech(
  source: DictationJobSource,
): void {
  safe(() => noSpeechCounter?.add(1, { source }));
}

// Action and question metrics carry type/intent/outcome attributes only:
// never titles, names, transcripts, questions or answers.
export function DictationTelemetryRecordActionProposed(type: string): void {
  safe(() => actionsProposedCounter?.add(1, { type }));
}

export function DictationTelemetryRecordActionResolution(
  type: string,
  outcome: string,
): void {
  safe(() => actionsResolutionCounter?.add(1, { type, outcome }));
}

export function DictationTelemetryRecordActionApplied(
  type: string,
  outcome: string,
): void {
  safe(() => actionsAppliedCounter?.add(1, { type, outcome }));
}

export function DictationTelemetryRecordActionUndo(
  type: string,
  outcome: string,
): void {
  safe(() => actionsUndoCounter?.add(1, { type, outcome }));
}

export function DictationTelemetryRecordAsk(
  intent: string,
  outcome: string,
): void {
  safe(() => askCounter?.add(1, { intent, outcome }));
}
