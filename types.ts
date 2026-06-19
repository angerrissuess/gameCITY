/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
export enum BuildingCategory {
  Infrastructure = 'Infrastructure',
  Residential = 'Residential',
  Commercial = 'Commercial',
  Industrial = 'Industrial',
  Decorations = 'Decorations'
}

export enum BuildingType {
  None = 'None',
  Road = 'Road',
  BuyLand = 'BuyLand',
  
  // Residential
  HouseSmall = 'HouseSmall',
  HouseMedium = 'HouseMedium',
  HouseLarge = 'HouseLarge',

  // Commercial
  ShopSmall = 'ShopSmall',
  ShopLarge = 'ShopLarge',
  Mall = 'Mall',
  FinancialCenter = 'FinancialCenter',

  // Industrial
  FactorySmall = 'FactorySmall',
  FactoryLarge = 'FactoryLarge',
  ChemicalPlant = 'ChemicalPlant',
  HighTechFactory = 'HighTechFactory',

  // Decorations
  ParkSmall = 'ParkSmall',
  ParkLarge = 'ParkLarge',
  AquaPark = 'AquaPark',
  AmusementPark = 'AmusementPark',
}

export interface BuildingConfig {
  type: BuildingType;
  category: BuildingCategory;
  cost: number;
  name: string;
  description: string;
  color: string;
  popGen: number;
  incomeGen: number;
  minLevel: number;
  width: number;
  height: number;
}

export interface TileData {
  x: number;
  y: number;
  buildingType: BuildingType;
  variant?: number;
  unlocked?: boolean;
  originX?: number; // Starting X of a multi-tile building
  originY?: number; // Starting Y of a multi-tile building
  rotation?: number; // Fixed rotation angle in radians (set at placement)
}

export type Grid = TileData[][];

export interface TechUpgrades {
  taxBoost: number; // e.g. 0.1 for 10%
  roadDiscount: number; // e.g. 0.5 for 50%
  parkBoost: number; // e.g. extra popGen/happiness
}

export interface CityStats {
  money: number;
  population: number;
  day: number;
  level: number;
  timeOfDay: number; // 0.0 to 1.0
  upgrades: TechUpgrades;
  happiness: number;
  tutorialCompleted: boolean;
}

export interface NewsItem {
  id: string;
  text: string;
  type: 'positive' | 'negative' | 'neutral';
}

export interface FloatingTextData {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
}

export interface Milestone {
  level: number;
  name: string;
  requiredPop: number;
}
