-- CreateTable
CREATE TABLE `StructureTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `wp` INTEGER NOT NULL,
    `panelCount` INTEGER NOT NULL,
    `meta` JSON NOT NULL,
    `modelKey` VARCHAR(191) NOT NULL,
    `thumbKey` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
