-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'DESIGNER', 'SALES') NOT NULL DEFAULT 'DESIGNER',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `slotMinutes` INTEGER NOT NULL DEFAULT 30,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Project` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `status` ENUM('UPLOADED', 'SENT_TO_CUSTOMER', 'COMMENTS_PENDING', 'MEETING_BOOKED', 'REVISED', 'APPROVED') NOT NULL DEFAULT 'UPLOADED',
    `customerName` VARCHAR(191) NOT NULL,
    `customerSalutation` ENUM('MR', 'MRS', 'MS', 'DR', 'NONE') NOT NULL DEFAULT 'NONE',
    `customerMobile` VARCHAR(191) NOT NULL,
    `customerEmail` VARCHAR(191) NULL,
    `address` TEXT NOT NULL,
    `latitude` DOUBLE NOT NULL,
    `longitude` DOUBLE NOT NULL,
    `northOffsetDeg` DOUBLE NOT NULL DEFAULT 0,
    `systemSizeKw` DOUBLE NOT NULL,
    `panelCount` INTEGER NOT NULL,
    `panelMake` VARCHAR(191) NOT NULL,
    `panelModel` VARCHAR(191) NOT NULL,
    `panelWattage` INTEGER NULL,
    `structureHeightM` DOUBLE NOT NULL,
    `structureType` VARCHAR(191) NOT NULL,
    `shareToken` VARCHAR(191) NOT NULL,
    `sentToCustomerAt` DATETIME(3) NULL,
    `designerId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Project_code_key`(`code`),
    UNIQUE INDEX `Project_shareToken_key`(`shareToken`),
    INDEX `Project_status_idx`(`status`),
    INDEX `Project_designerId_idx`(`designerId`),
    INDEX `Project_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DesignVersion` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `status` ENUM('QUEUED', 'PROCESSING', 'READY', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `changeNotes` TEXT NULL,
    `originalKey` VARCHAR(191) NOT NULL,
    `originalFormat` ENUM('GLB', 'DAE', 'ZIP') NOT NULL,
    `originalFilename` VARCHAR(255) NOT NULL,
    `originalBytes` INTEGER NOT NULL,
    `modelKey` VARCHAR(191) NULL,
    `modelBytes` INTEGER NULL,
    `reportKey` VARCHAR(191) NULL,
    `snapshots` JSON NULL,
    `shadingSummary` JSON NULL,
    `detectedPanelCount` INTEGER NULL,
    `bbox` JSON NULL,
    `processingLog` TEXT NULL,
    `processingError` TEXT NULL,
    `processedAt` DATETIME(3) NULL,
    `processingStartedAt` DATETIME(3) NULL,
    `lockedAt` DATETIME(3) NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DesignVersion_projectId_number_key`(`projectId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectEvent` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `actor` VARCHAR(191) NOT NULL,
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectEvent_projectId_createdAt_idx`(`projectId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Job` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `runAfter` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Job_status_runAfter_idx`(`status`, `runAfter`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtpChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `mobile` VARCHAR(191) NOT NULL,
    `purpose` ENUM('VIEW_ACCESS', 'APPROVAL') NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `consumedAt` DATETIME(3) NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OtpChallenge_projectId_purpose_createdAt_idx`(`projectId`, `purpose`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Comment` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `versionId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `authorType` ENUM('CUSTOMER', 'TEAM') NOT NULL,
    `authorUserId` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `anchor` JSON NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Comment_projectId_versionId_idx`(`projectId`, `versionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WeeklyAvailability` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `weekday` INTEGER NOT NULL,
    `startMinute` INTEGER NOT NULL,
    `endMinute` INTEGER NOT NULL,

    INDEX `WeeklyAvailability_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimeOff` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `reason` TEXT NULL,

    INDEX `TimeOff_userId_startsAt_idx`(`userId`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Meeting` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `designerId` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `status` ENUM('BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW') NOT NULL DEFAULT 'BOOKED',
    `bookedBy` ENUM('CUSTOMER', 'TEAM') NOT NULL,
    `videoProvider` VARCHAR(191) NOT NULL,
    `roomName` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `cancelReason` TEXT NULL,
    `rescheduledFromId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Meeting_roomName_key`(`roomName`),
    INDEX `Meeting_designerId_startsAt_idx`(`designerId`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `channel` ENUM('WHATSAPP', 'SMS', 'EMAIL') NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `to` VARCHAR(191) NOT NULL,
    `template` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `providerMessageId` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_projectId_createdAt_idx`(`projectId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Approval` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `versionId` VARCHAR(191) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerMobile` VARCHAR(191) NOT NULL,
    `consentText` TEXT NOT NULL,
    `videoKey` VARCHAR(191) NOT NULL,
    `videoMime` VARCHAR(191) NOT NULL,
    `videoBytes` INTEGER NOT NULL,
    `videoSha256` VARCHAR(191) NOT NULL,
    `recordHash` VARCHAR(191) NOT NULL,
    `otpChallengeId` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `deviceInfo` JSON NULL,
    `approvedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Approval_otpChallengeId_key`(`otpChallengeId`),
    INDEX `Approval_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_designerId_fkey` FOREIGN KEY (`designerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DesignVersion` ADD CONSTRAINT `DesignVersion_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DesignVersion` ADD CONSTRAINT `DesignVersion_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectEvent` ADD CONSTRAINT `ProjectEvent_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtpChallenge` ADD CONSTRAINT `OtpChallenge_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `DesignVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Comment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_authorUserId_fkey` FOREIGN KEY (`authorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WeeklyAvailability` ADD CONSTRAINT `WeeklyAvailability_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimeOff` ADD CONSTRAINT `TimeOff_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Meeting` ADD CONSTRAINT `Meeting_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Meeting` ADD CONSTRAINT `Meeting_designerId_fkey` FOREIGN KEY (`designerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Approval` ADD CONSTRAINT `Approval_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Approval` ADD CONSTRAINT `Approval_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `DesignVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Approval` ADD CONSTRAINT `Approval_otpChallengeId_fkey` FOREIGN KEY (`otpChallengeId`) REFERENCES `OtpChallenge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
