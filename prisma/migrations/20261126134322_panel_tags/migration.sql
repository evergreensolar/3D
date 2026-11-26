-- AlterTable
ALTER TABLE `DesignVersion` ADD COLUMN `panelTags` JSON NULL,
    ADD COLUMN `panelsKey` VARCHAR(191) NULL;
