import { bootstrapComputeHost } from '@/core';
import { getPlatform } from '@/platform';

// Created on demand by ensureComputeHost() on Chromium only (SPEC §4.1, §4.3.1).
void bootstrapComputeHost(getPlatform());
