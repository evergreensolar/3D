-- AlterTable
ALTER TABLE `DesignVersion` ADD COLUMN `designJson` JSON NULL,
    ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'upload';
