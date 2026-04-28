#!/usr/bin/env python3
"""
Train CNN classifier for AI vs Real image detection.

Usage:
    python scripts/train_cnn.py [--epochs 10] [--batch-size 32] [--learning-rate 0.001]
"""

import os
import sys
import argparse
from pathlib import Path

script_dir = os.path.dirname(os.path.abspath(__file__))
project_dir = os.path.dirname(script_dir)
sys.path.insert(0, project_dir)
os.chdir(project_dir)

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import models, transforms
from torchvision.models import ResNet50_Weights
from PIL import Image
from tqdm import tqdm


class AIDetectionDataset(Dataset):
    def __init__(self, data_dir: str, transform=None):
        self.data_dir = Path(data_dir)
        self.transform = transform or self.get_default_transform()

        self.samples = []
        self._load_samples()

    def get_default_transform(self):
        return transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.RandomHorizontalFlip(p=0.5),
            transforms.RandomRotation(degrees=10),
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
            transforms.ToTensor(),
            transforms.Normalize(
                [0.485, 0.456, 0.406],
                [0.229, 0.224, 0.225]
            )
        ])

    def _load_samples(self):
        ai_dir = self.data_dir / "ai"
        real_dir = self.data_dir / "real"

        extensions = ["*.png", "*.jpg", "*.jpeg", "*.webp"]
        skipped = 0

        if ai_dir.exists():
            for ext in extensions:
                for img_path in ai_dir.glob(ext):
                    if self._validate_image(img_path):
                        self.samples.append((str(img_path), 1))
                    else:
                        skipped += 1

        if real_dir.exists():
            for ext in extensions:
                for img_path in real_dir.glob(ext):
                    if self._validate_image(img_path):
                        self.samples.append((str(img_path), 0))
                    else:
                        skipped += 1

        if skipped > 0:
            print(f"  Skipped {skipped} corrupt images")

        print(f"Loaded {len(self.samples)} samples from {self.data_dir}")
        ai_count = sum(1 for _, label in self.samples if label == 1)
        real_count = len(self.samples) - ai_count
        print(f"  AI: {ai_count}, Real: {real_count}")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        img_path, label = self.samples[idx]
        image = Image.open(img_path).convert("RGB")

        if self.transform:
            image = self.transform(image)

        return image, label

    def _validate_image(self, img_path):
        try:
            with Image.open(img_path) as img:
                img.verify()
            return True
        except Exception:
            return False


def train_model(
    train_dir: str,
    val_dir: str,
    epochs: int = 10,
    batch_size: int = 32,
    learning_rate: float = 0.001,
    output_path: str = "resnet50_veridex.pt"
):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # Load datasets
    print("\nLoading training data...")
    train_dataset = AIDetectionDataset(train_dir)
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=4,
        pin_memory=True
    )

    print("\nLoading validation data...")
    val_dataset = AIDetectionDataset(val_dir)
    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=4,
        pin_memory=True
    )

    # Create model
    print("\nInitializing model...")
    model = models.resnet50(weights=ResNet50_Weights.IMAGENET1K_V2)
    model.fc = nn.Linear(model.fc.in_features, 2)
    model = model.to(device)

    # Loss and optimizer
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=learning_rate)
    scheduler = optim.lr_scheduler.StepLR(optimizer, step_size=3, gamma=0.1)

    # Training loop
    best_val_acc = 0.0

    for epoch in range(epochs):
        print(f"\nEpoch {epoch + 1}/{epochs}")
        print("-" * 50)

        # Training
        model.train()
        running_loss = 0.0
        correct = 0
        total = 0

        pbar = tqdm(train_loader, desc="Training")
        for images, labels in pbar:
            images, labels = images.to(device), labels.to(device)

            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            running_loss += loss.item()
            _, predicted = outputs.max(1)
            total += labels.size(0)
            correct += predicted.eq(labels).sum().item()

            pbar.set_postfix({
                'loss': f'{loss.item():.4f}',
                'acc': f'{100.*correct/total:.2f}%'
            })

        train_acc = 100. * correct / total
        train_loss = running_loss / len(train_loader)

        # Validation
        model.eval()
        val_loss = 0.0
        correct = 0
        total = 0

        with torch.no_grad():
            for images, labels in tqdm(val_loader, desc="Validation"):
                images, labels = images.to(device), labels.to(device)
                outputs = model(images)
                loss = criterion(outputs, labels)

                val_loss += loss.item()
                _, predicted = outputs.max(1)
                total += labels.size(0)
                correct += predicted.eq(labels).sum().item()

        val_acc = 100. * correct / total
        val_loss = val_loss / len(val_loader)

        scheduler.step()

        print(f"Train Loss: {train_loss:.4f}, Train Acc: {train_acc:.2f}%")
        print(f"Val Loss: {val_loss:.4f}, Val Acc: {val_acc:.2f}%")

        # Save best model
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save(model.state_dict(), output_path)
            print(f"Saved best model to {output_path}")

    print(f"\nTraining complete! Best validation accuracy: {best_val_acc:.2f}%")


def main():
    parser = argparse.ArgumentParser(description="Train CNN classifier for AI detection")
    parser.add_argument("--train-dir", default="data/train", help="Training data directory")
    parser.add_argument("--val-dir", default="data/val", help="Validation data directory")
    parser.add_argument("--epochs", type=int, default=10, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size")
    parser.add_argument("--learning-rate", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--output", default="resnet50_veridex.pt", help="Output model path")

    args = parser.parse_args()

    train_model(
        train_dir=args.train_dir,
        val_dir=args.val_dir,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        output_path=args.output
    )


if __name__ == "__main__":
    main()