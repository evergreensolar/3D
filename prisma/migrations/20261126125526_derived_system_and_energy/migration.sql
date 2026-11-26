-- AlterTable
ALTER TABLE `DesignVersion` ADD COLUMN `energyEstimate` JSON NULL,
    ADD COLUMN `layout` JSON NULL;

-- AlterTable
ALTER TABLE `Project` MODIFY `systemSizeKw` DOUBLE NULL,
    MODIFY `panelCount` INTEGER NULL,
    MODIFY `panelMake` VARCHAR(191) NULL,
    MODIFY `panelModel` VARCHAR(191) NULL,
    MODIFY `structureHeightM` DOUBLE NULL,
    MODIFY `structureType` VARCHAR(191) NULL;
