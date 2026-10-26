from enum import Enum


class TaskStatus(str, Enum):
    CREATED = "created"
    UPLOADING = "uploading"
    QUEUED = "queued"
    RUNNING = "running"
    DOWNLOADING = "downloading"
    EVALUATING = "evaluating"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


TRANSITIONS = {
    TaskStatus.CREATED: {TaskStatus.UPLOADING, TaskStatus.FAILED, TaskStatus.CANCELLED},
    TaskStatus.UPLOADING: {TaskStatus.QUEUED, TaskStatus.FAILED, TaskStatus.CANCELLED},
    TaskStatus.QUEUED: {TaskStatus.RUNNING, TaskStatus.FAILED, TaskStatus.CANCELLED},
    TaskStatus.RUNNING: {TaskStatus.DOWNLOADING, TaskStatus.FAILED, TaskStatus.CANCELLED},
    TaskStatus.DOWNLOADING: {TaskStatus.EVALUATING, TaskStatus.FAILED, TaskStatus.CANCELLED},
    TaskStatus.EVALUATING: {TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELLED},
    TaskStatus.SUCCEEDED: set(),
    TaskStatus.FAILED: set(),
    TaskStatus.CANCELLED: set(),
}


def require_transition(current: TaskStatus, target: TaskStatus) -> None:
    if target not in TRANSITIONS[current]:
        raise ValueError(f"Invalid task transition: {current.value} -> {target.value}")
