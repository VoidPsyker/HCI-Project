import argparse
import csv
import json
from collections import Counter
from pathlib import Path

import numpy as np
import sklearn
from sklearn.dummy import DummyClassifier
from sklearn.metrics import accuracy_score, balanced_accuracy_score, confusion_matrix, f1_score
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.tree import DecisionTreeClassifier

FEATURES = (
    "elapsed_ms", "clicks", "backtracks", "category_switches",
    "wrong_department", "wrong_subcategory", "wrong_leaf",
)
MOODS = {"happy", "frustrated", "confused", "bored", "mixed"}


def read_csv(folder, name):
    with (folder / (name + ".csv")).open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def eligible_trials(folder):
    events = read_csv(folder, "events")
    checkins = read_csv(folder, "checkins")
    trials = read_csv(folder, "trials")
    by_block = {}
    for row in checkins:
        if json.loads(row["meta"]).get("phase") == "post_induction":
            key = (row["session_id"], row["block_id"])
            by_block.setdefault(key, set()).add(row["reported_state"])
    test_sessions = set()
    trial_starts = Counter()
    for event in events:
        if event["event_type"] == "trial_start":
            trial_starts[event["session_id"], event["trial_id"]] += 1
        elif event["event_type"] == "session_start":
            meta = json.loads(event["meta"])
            if meta.get("fast_mode") or meta.get("synthetic"):
                test_sessions.add(event["session_id"])

    eligible = []
    excluded = Counter()
    for row in trials:
        label = row["reported_state"]
        key = (row["session_id"], row["block_id"])
        if row["practice"] != "0":
            excluded["practice"] += 1
        elif row["synthetic"] != "0" or row["session_id"] in test_sessions:
            excluded["synthetic_or_unknown_provenance"] += 1
        elif (row["missing_trial_start"], row["missing_trial_end"], row["trial_end_count"]) != ("0", "0", "1"):
            excluded["incomplete_trial"] += 1
        elif trial_starts[row["session_id"], row["trial_id"]] != 1:
            excluded["ambiguous_trial_start"] += 1
        elif label not in MOODS or by_block.get(key) != {label}:
            excluded["missing_or_conflicting_report"] += 1
        elif not row["participant_id"] or not all(row[field] for field in FEATURES):
            excluded["missing_features_or_group"] += 1
        else:
            eligible.append(row)
    return eligible, excluded, len(trials)


def new_tree():
    return DecisionTreeClassifier(max_depth=2, min_samples_leaf=3, random_state=42)


def metrics(labels, predictions, classes):
    return {
        "accuracy": accuracy_score(labels, predictions),
        "balanced_accuracy": balanced_accuracy_score(labels, predictions) if len(classes) > 1 else None,
        "macro_f1": f1_score(labels, predictions, labels=classes, average="macro", zero_division=0) if len(classes) > 1 else None,
        "confusion_matrix": confusion_matrix(labels, predictions, labels=classes).tolist() if len(classes) > 1 else [[len(labels)]],
    }


def portable_tree(model, index=0):
    tree = model.tree_
    if tree.children_left[index] == tree.children_right[index]:
        return {
            "prediction": str(model.classes_[tree.value[index][0].argmax()]),
            "training_rows": int(tree.n_node_samples[index]),
        }
    return {
        "feature": FEATURES[tree.feature[index]],
        "threshold": float(tree.threshold[index]),
        "if_at_or_below": portable_tree(model, tree.children_left[index]),
        "otherwise": portable_tree(model, tree.children_right[index]),
    }


def predict(tree, features):
    while "prediction" not in tree:
        value = float(features[tree["feature"]])
        if not np.isfinite(value):
            raise ValueError("Features must be finite")
        branch = "if_at_or_below" if value <= tree["threshold"] else "otherwise"
        tree = tree[branch]
    return tree["prediction"]


def train(data_folder, output):
    rows, excluded, total = eligible_trials(data_folder)
    labels = np.array([row["reported_state"] for row in rows])
    groups = np.array([row["participant_id"] for row in rows])
    classes = sorted(set(labels))
    if len(set(groups)) < 2:
        raise ValueError("Need eligible trials from at least two participants for evaluation")
    values = np.array([[float(row[key]) for key in FEATURES] for row in rows])
    tree_predictions = np.empty_like(labels)
    baseline_predictions = np.empty_like(labels)
    folds = []
    for train_indices, test_indices in LeaveOneGroupOut().split(values, labels, groups):
        model = new_tree().fit(values[train_indices], labels[train_indices])
        baseline = DummyClassifier(strategy="most_frequent").fit(values[train_indices], labels[train_indices])
        tree_predictions[test_indices] = model.predict(values[test_indices])
        baseline_predictions[test_indices] = baseline.predict(values[test_indices])
        folds.append({
            "test_rows": len(test_indices),
            "test_labels": dict(Counter(labels[test_indices])),
            "labels_missing_from_training": sorted(set(labels[test_indices]) - set(labels[train_indices])),
        })

    fitted = new_tree().fit(values, labels)
    model = {
        "target": "reported_state",
        "prediction_time": "after_trial",
        "status": "single_class_baseline" if len(classes) == 1 else "pilot_prototype",
        "features": FEATURES,
        "classes": classes,
        "scikit_learn_version": sklearn.__version__,
        "tree": portable_tree(fitted),
    }
    restored = json.loads(json.dumps(model))
    assert [predict(restored["tree"], dict(zip(FEATURES, row))) for row in values] == fitted.predict(values).tolist()
    summary = {
        "total_trials": total,
        "eligible_trials": len(rows),
        "excluded": dict(excluded),
        "participants": len(set(groups)),
        "blocks": len({(row["session_id"], row["block_id"]) for row in rows}),
        "label_counts": dict(Counter(labels)),
        "participants_per_label": {label: len(set(groups[labels == label])) for label in classes},
        "evaluation": "leave_one_participant_out",
        "mood_discrimination_evaluable": len(classes) > 1 and all(len(set(groups[labels == label])) > 1 for label in classes),
        "confusion_matrix_label_order": classes,
        "tree": metrics(labels, tree_predictions, classes),
        "majority_baseline": metrics(labels, baseline_predictions, classes),
        "folds": folds,
        "fitted_tree": model["tree"],
    }
    output.mkdir(parents=True, exist_ok=True)
    for name, content in (("model.json", model), ("evaluation.json", summary)):
        (output / name).write_text(json.dumps(content, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train or run a shallow pilot mood classifier.")
    sub = parser.add_subparsers(dest="command", required=True)
    fit = sub.add_parser("train")
    fit.add_argument("data", type=Path)
    fit.add_argument("output", type=Path)
    inference = sub.add_parser("predict")
    inference.add_argument("model", type=Path)
    inference.add_argument("features", type=Path)
    args = parser.parse_args()
    if args.command == "train":
        train(args.data, args.output)
    else:
        model = json.loads(args.model.read_text(encoding="utf-8"))
        features = json.loads(args.features.read_text(encoding="utf-8"))
        print(predict(model["tree"], features))
